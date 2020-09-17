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
	// TODO: Create a map of IDs to ReactStat objects. Each request that contains
	// React gets it's own ID that is used in the injected code to identify this
	// React instance. Pages should call the exposed function with their id and
	// their stats so we can add the stats to the right React instance.
	/** @type {Map<string, ReactStats>} */
	const statsMap = new Map();

	await page.setRequestInterception(true);

	const controller = new AbortController();
	page.on("close", () => {
		logger.debug("Closing page...");
		controller.abort();
	});

	page.exposeFunction("__COLLECT_REACT_STATS__", function (id, time, vnodes) {
		const stats = statsMap.get(id);
		stats.logs.push({ time, vnodes });
		stats.vnodes.total += vnodes.length;
	});

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
 * @property {Array<{ time: number; vnodes: number }>} logs
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
