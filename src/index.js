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
 * @param {puppeteer.Page} page
 * @param {Logger} logger
 * @returns {Promise<() => Promise<ReactStats[]>>}
 */
async function setupCollection(page, logger) {
	/** @type {Map<string, ReactStats>} */
	const statsMap = new Map();

	/**
	 * @param {string} id
	 * @param {number} time
	 * @param {ReactStatLog["vNodeStats"]} vNodeStats
	 * @param {ReactStatLog["singleChildStats"]} singleChildStats
	 */
	function collectStats(id, time, vNodeStats, singleChildStats) {
		const stats = statsMap.get(id);
		stats.logs.push({ time, vNodeStats, singleChildStats });
		stats.vnodes.total += vNodeStats
			.map((category) => category[1].map((childCount) => childCount[1]))
			.flat(2)
			.reduce((total, subtotal) => total + subtotal, 0);
	}

	await page.setRequestInterception(true);

	const controller = new AbortController();
	page.on("close", () => {
		logger.debug("Closing page...");
		controller.abort();
	});

	page.exposeFunction("__COLLECT_REACT_STATS__", collectStats);

	page.on("request", async (request) => {
		if (request.resourceType() !== "script") {
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
				vnodes: { total: 0 },
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

	return async () => Array.from(statsMap.values());
}

/**
 * @typedef ReactStats
 * @property {string} id
 * @property {string} frameUrl
 * @property {string} requestUrl
 * @property {{ total: number }} vnodes
 * @property {ReactStatLog[]} logs
 *
 * @typedef ReactStatLog
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
 * @returns {Promise<ReactStats[]>}
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
