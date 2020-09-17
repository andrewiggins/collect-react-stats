import puppeteer from "puppeteer";
import fetch from "node-fetch";
import AbortController from "abort-controller";

/**
 * @param {puppeteer.Browser} browser
 * @param {string} errorMessage
 */
async function exitWithError(browser, errorMessage) {
	await browser.close();
	throw new Error(errorMessage);
}

/**
 * @param {puppeteer.Page} page
 * @returns {Promise<() => Promise<ReactStats[]>>}
 */
async function setupCollection(page) {
	// TODO: Create a map of IDs to ReactStat objects. Each request that contains
	// React gets it's own ID that is used in the injected code to identify this
	// React instance. Pages should call the exposed function with their id and
	// their stats so we can add the stats to the right React instance.

	await page.setRequestInterception(true);

	const controller = new AbortController();
	page.on("close", () => {
		console.log("Closing page...");
		controller.abort();
	});

	page.on("request", async (request) => {
		if (request.resourceType() !== "script") {
			return request.continue();
		}

		/** @type {import('node-fetch').RequestInit} */
		const requestInit = {
			method: request.method(),
			headers: request.headers(),
			body: request.postData(),
			follow: 20,
			signal: controller.signal,
		};

		console.log(`[${request.frame().url()}]: Fetching ${request.url()} ...`);

		let response;
		try {
			response = await fetch(request.url(), requestInit);
		} catch (error) {
			if (error.name === "AbortError") {
				await request.abort();
				return;
			} else {
				throw error;
			}
		}

		/** @type {Record<string, string>} */
		const headers = {};
		response.headers.forEach((value, name) => {
			headers[name] = value;
		});

		await request.respond({
			status: response.status,
			headers,
			body: await response.buffer(),
		});
	});

	// TODO: Consider how to report data from page to nodejs
	// Perhaps exposeFunction: https://pptr.dev/#?product=Puppeteer&version=v5.3.0&show=api-pageexposefunctionname-puppeteerfunction
	// Perhaps page.on('console'): https://pptr.dev/#?product=Puppeteer&version=v5.3.0&show=api-event-console

	return async () => {
		return [{ id: "", frameUrl: "", jsUrl: "", vnodes: { total: 0 } }];
	};
}

/**
 * @typedef ReactStats
 * @property {string} id
 * @property {string} frameUrl
 * @property {string} jsUrl
 * @property {{ total: number }} vnodes
 *
 * @param {string} url
 * @returns {Promise<ReactStats[]>}
 */
export async function collectStats(url) {
	console.log("Launching browser...");
	const browser = await puppeteer.launch({
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

	const getStats = await setupCollection(page);
	if (url) {
		page.goto(url);
	}

	console.log("Collecting stats on the second tab...");

	await new Promise((resolve) => {
		browser.on("disconnected", () => resolve());
	});

	return getStats();
}
