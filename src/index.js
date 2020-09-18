import puppeteer from "puppeteer";
import fetch from "node-fetch";
import AbortController from "abort-controller";
import { containsReact, injectReactCounters } from "./inject.js";

let id = 0;

/**
 * @param {() => puppeteer.Browser} getBrowser
 * @param {Options} options
 */
function createLogger(getBrowser, options) {
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
 * @typedef {{ total: number; data: Record<string, number> }} Row
 * @typedef {{ total: Row, rows: Record<string, Row> }} Table
 *
 * @typedef ReactStatsSummary
 * @property {Table} vnodes
 * @property {Row} singleChild
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

			for (let [category, count] of log.singleChildStats) {
				singleChildRow.total += count;

				if (category in singleChildRow.data) {
					singleChildRow.data[category] += count;
				} else {
					singleChildRow.data[category] = count;
				}
			}
		}

		// summary.vnodes.total += log.vNodeStats
		// 	.map((category) => category[1].map((childCount) => childCount[1]))
		// 	.flat(2)
		// 	.reduce((total, subtotal) => total + subtotal, 0);

		summarizedStats.push({
			id: stats.id,
			frameUrl: stats.frameUrl,
			requestUrl: stats.requestUrl,
			summary: {
				vnodes: vNodeTable,
				singleChild: singleChildRow,
			},
			logs: stats.logs,
		});
	}

	return summarizedStats;
}

/**
 * @param {puppeteer.Page} page
 * @param {Logger} logger
 * @returns {Promise<() => SummarizedReactStats[]>}
 */
async function setupCollection(page, logger) {
	/** @type {Map<string, ReactStats>} */
	const statsMap = new Map();

	await page.setRequestInterception(true);

	page.exposeFunction(
		"__COLLECT_REACT_STATS__",
		(id, time, vNodeStats, singleChildStats) => {
			statsMap.get(id).logs.push({ time, vNodeStats, singleChildStats });
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
			logger.warn("Skipping non http(s) URL: " + request.url().slice(0, 100));
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
 * @property {number} time
 * @property {Array<[string, [number, number][]]>} vNodeStats
 * @property {Array<[string, number]>} singleChildStats
 *
 * @typedef Options
 * @property {boolean} debug
 *
 * @typedef {ReturnType<createLogger>} Logger
 *
 * @param {string} url
 * @param {Options} options
 * @returns {Promise<SummarizedReactStats[]>}
 */
export async function collectStats(url, options) {
	let browser;
	const logger = createLogger(() => browser, options);

	logger.debug("Launching browser...");
	browser = await puppeteer.launch({
		headless: false,
		defaultViewport: null,
	});

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
