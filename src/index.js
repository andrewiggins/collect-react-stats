import path from "path";
import { fileURLToPath } from "url";
import { readFileSync } from "fs";
import fetch from "node-fetch";
import AbortController from "abort-controller";

let id = 0;
const createElementReturn = /return{\$\$typeof:([a-zA-z]+),type:([a-zA-z]+),key:([a-zA-z]+),ref:([a-zA-z]+),props:([a-zA-z]+),_owner:/g;
/** @type {(text: string) => boolean} */
const containsReact = (text) => text.match(createElementReturn) != null;

// @ts-ignore
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const reportJsTemplate = readFileSync(
	path.join(__dirname, "injectionHelpers.js"),
	"utf8"
);

/**
 * @param {() => import('puppeteer-core').Browser} getBrowser
 * @param {Options} options
 */
export function createLogger(getBrowser, options) {
	return {
		debug(...args) {
			if (options.debug) {
				console.log(...args);
			}
		},
		info(...args) {
			console.log(...args);
		},
		warn(...args) {
			console.warn(...args);
		},
		async error(errorMessage) {
			await getBrowser()?.close();
			throw new Error(errorMessage);
		},
	};
}

/**
 * @param {Row} row
 * @param {Array<[string, number]>} logs
 */
function summarizeRow(row, logs) {
	for (let [category, count] of logs) {
		row.total += count;

		if (category in row.data) {
			row.data[category] += count;
		} else {
			row.data[category] = count;
		}
	}
}

/**
 * @typedef {{ total: number; data: Record<string, number> }} Row
 * @typedef {{ total: Row, rows: Record<string, Row> }} Table
 *
 * @typedef ReactStatsSummary
 * @property {Table} vnodes
 * @property {Row} singleChild
 * @property {Row} domProps
 *
 * @typedef {ReactStats & { summary: ReactStatsSummary }} SummarizedReactStats
 *
 * @param {Map<string, ReactStats>} statsMap
 * @returns {SummarizedReactStats[]}
 */
function summarizeStats(statsMap) {
	/** @type {SummarizedReactStats[]} */
	const summarizedStats = [];
	for (const stats of statsMap.values()) {
		if (stats.logs.length == 0) {
			continue;
		}

		/** @type {Table} */
		const vNodeTable = {
			total: { total: 0, data: {} },
			rows: {},
		};

		/** @type {Row} */
		const singleChildRow = {
			total: 0,
			data: {},
		};

		/** @type {Row} */
		const domPropsRow = {
			total: 0,
			data: {},
		};

		for (const log of stats.logs) {
			for (let [category, childrenCounts] of log.vNodeStats) {
				for (let [numberOfChildren, count] of childrenCounts) {
					const row = category;
					const column = numberOfChildren.toString();

					if (row in vNodeTable.rows) {
						vNodeTable.rows[row].total += count;
					} else {
						vNodeTable.rows[row] = { total: count, data: {} };
					}

					if (column in vNodeTable.rows[row].data) {
						vNodeTable.rows[row].data[column] += count;
					} else {
						vNodeTable.rows[row].data[column] = count;
					}

					vNodeTable.total.total += count;
					if (column in vNodeTable.total.data) {
						vNodeTable.total.data[column] += count;
					} else {
						vNodeTable.total.data[column] = count;
					}
				}
			}

			summarizeRow(singleChildRow, log.singleChildStats);
			summarizeRow(domPropsRow, log.domPropStats);
		}

		summarizedStats.push({
			id: stats.id,
			frameUrl: stats.frameUrl,
			requestUrl: stats.requestUrl,
			summary: {
				vnodes: vNodeTable,
				singleChild: singleChildRow,
				domProps: domPropsRow,
			},
			logs: stats.logs,
		});
	}

	return summarizedStats;
}

/**
 * @param {string} id
 * @param {string} scriptText
 * @returns {string}
 */
function injectReactCounters(id, scriptText) {
	const helpers = reportJsTemplate.replace(/__ID__/g, id) + "\n\n";
	const newBody = scriptText.replace(
		createElementReturn,
		(substring, $$typeofVar, typeVar, keyVar, refVar, propsVar) => {
			return (
				`reportVNode${id}(${$$typeofVar}, ${typeVar}, ${keyVar}, ${refVar}, ${propsVar});` +
				substring
			);
		}
	);

	return helpers + newBody;
}

/**
 * @param {import('puppeteer-core').Page} page
 * @param {Logger} logger
 * @returns {Promise<() => SummarizedReactStats[]>}
 */
async function setupCollection(page, logger) {
	/** @type {Map<string, ReactStats>} */
	const statsMap = new Map();

	await page.setRequestInterception(true);

	page.exposeFunction(
		"__COLLECT_REACT_STATS__",
		(id, timing, vNodeStats, singleChildStats, domPropStats) => {
			statsMap.get(id).logs.push({
				timing,
				vNodeStats,
				singleChildStats,
				domPropStats,
			});
		}
	);

	const controller = new AbortController();
	page.on("close", () => {
		logger.debug("Closing page...");
		controller.abort();
	});

	page.on("request", async (request) => {
		if (request.resourceType() !== "script") {
			return request.continue();
		}

		// TODO: Investigate handling data: urls
		// e.g. data:application/x-javascript; charset=utf-8;base64,aWYg
		if (
			!request.url().startsWith("http") &&
			!request.url().startsWith("https:")
		) {
			logger.warn(
				"Skipping non http(s) URL: " + request.url().slice(0, 100) + "..."
			);
			return request.continue();
		}

		const frameUrl = request.frame().url();
		const requestUrl = request.url();

		/** @type {import('node-fetch').RequestInit} */
		const requestInit = {
			method: request.method(),
			headers: request.headers(),
			body: request.postData(),
			follow: 20,
			signal: controller.signal,
		};

		let response;
		try {
			response = await fetch(requestUrl, requestInit);
		} catch (error) {
			if (error.name === "AbortError") {
				await request.abort();
				return;
			} else {
				throw error;
			}
		}

		let body = await response.text();
		if (containsReact(body)) {
			const statsId = id.toString();
			id++;

			statsMap.set(statsId, {
				id: statsId,
				frameUrl,
				requestUrl,
				logs: [],
			});

			body = injectReactCounters(statsId, body);

			logger.debug(`React!! [${frameUrl}]: Fetched ${requestUrl}`);
		} else {
			// logger.debug(`[${frameUrl}]: Fetched ${requestUrl}`);
		}

		/** @type {Record<string, string>} */
		const headers = {};
		response.headers.forEach((value, name) => {
			headers[name] = value;
		});

		await request.respond({
			status: response.status,
			headers,
			body,
		});
	});

	return () => summarizeStats(statsMap);
}

/**
 * @typedef ReactStats
 * @property {string} id
 * @property {string} frameUrl
 * @property {string} requestUrl
 * @property {ReactStatsLog[]} logs
 *
 * @typedef ReactStatsLog
 * @property {{ start: number; end: number; rate: number; total: number; }} timing
 * @property {Array<[string, [number, number][]]>} vNodeStats
 * @property {Array<[string, number]>} singleChildStats
 * @property {Array<[string, number]>} domPropStats
 *
 * @typedef Options
 * @property {boolean} debug
 *
 * @typedef {ReturnType<createLogger>} Logger
 *
 * @param {import('puppeteer-core').Browser} browser
 * @param {string} url
 * @param {Options} options
 * @returns {Promise<SummarizedReactStats[]>}
 */
export async function collectReactStats(browser, url, options) {
	const logger = createLogger(() => browser, options);

	const page = await browser.newPage();
	const pages = await browser.pages();
	for (let otherPage of pages) {
		if (otherPage !== page) {
			await otherPage.close();
		}
	}

	const getStats = await setupCollection(page, logger);
	if (url) {
		page.goto(url);
	}

	logger.debug("Collecting stats...");

	await new Promise((resolve) => {
		browser.on("disconnected", () => resolve());
	});

	return getStats();
}
