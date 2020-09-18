#!/usr/bin/env node

import path from "path";
import { writeFile, mkdir } from "fs/promises";
import sade from "sade";
import tableExport from "table";
import { collectStats } from "../src/index.js";

const { table, getBorderCharacters } = tableExport;

/**
 * @param {Table} stats
 * @returns {string[]}
 */
function computeColumns(stats) {
	const columns = Object.values(stats.rows)
		.map((row) => Object.keys(row.data))
		.flat();

	return Array.from(new Set(columns))
		.map((key) => parseInt(key, 10))
		.sort((a, b) => a - b)
		.map((n) => n.toString());
}

/**
 * @param {string[]} columns
 * @param {string} rowLabel
 * @param {Row} rowData
 * @returns {Array<string | number>}
 */
function buildTableRow(columns, rowLabel, { total, data }) {
	const row = [];
	row.push(rowLabel, total);
	for (let column of columns) {
		row.push(column in data ? data[column] : "");
	}

	return row;
}

/**
 * @typedef {import('../src/index').Row} Row
 * @typedef {import('../src/index').Table} Table
 * @param {Table} stats
 */
function buildStatsTable(stats) {
	const columns = computeColumns(stats);
	const rows = Object.keys(stats.rows).sort((a, b) => {
		const nameA = a.toUpperCase();
		const nameB = b.toUpperCase();
		return nameA < nameB ? -1 : nameA > nameB ? 1 : 0;
	});

	/** @type {Array<string | number>[]} */
	const tableData = [["Type", "Total", ...columns]];
	for (let key of rows) {
		tableData.push(buildTableRow(columns, key, stats.rows[key]));
	}

	tableData.push(buildTableRow(columns, "Totals", stats.total));

	return table(tableData, { border: getBorderCharacters("norc") });
}

/**
 * @param {Row} stats
 */
function buildStatsTableFromRow(stats) {
	const rows = Object.keys(stats.data).sort((a, b) => {
		const nameA = a.toUpperCase();
		const nameB = b.toUpperCase();
		return nameA < nameB ? -1 : nameA > nameB ? 1 : 0;
	});

	/** @type {Array<string | number>[]} */
	const tableData = [["Type", "Total"]];
	for (let row of rows) {
		tableData.push([row, stats.data[row]]);
	}

	tableData.push(["Total", stats.total]);

	return table(tableData, { border: getBorderCharacters("norc") });
}

async function run(url, opts) {
	console.log(
		"Close the browser when you are finished collecting your sample to see your results."
	);

	const results = await collectStats(url, opts);
	const resultJSON = JSON.stringify(results, null, 2);

	const outputFile = path.isAbsolute(opts.output)
		? opts.output
		: path.join(process.cwd(), opts.output);

	await mkdir(path.dirname(outputFile), { recursive: true });
	await writeFile(outputFile, resultJSON, "utf8");

	if (results.length == 0) {
		console.log("React not found on any webpages visited");
		return;
	}

	for (let i = 0; i < results.length; i++) {
		let result = results[i];

		console.log();
		console.log("Results for", result.frameUrl);
		console.log();
		console.log("Render Frequency:");
		console.log(
			"(Columns are number of children. Data is number of times that type rendered with that number of children)"
		);
		console.log(buildStatsTable(result.summary.vnodes));
		console.log("Single child type:");
		console.log(buildStatsTableFromRow(result.summary.singleChild));
		console.log();

		if (i + 1 < results.length) {
			console.log();
			console.log("=".repeat(100));
		}
	}
}

sade("react-stats [file]", true)
	.describe("Collect stats about React usage on a website")
	.example("https://reactjs.org")
	.option("-o --output", "File to output results to", "react-stats.json")
	.option("-d --debug", "Enable extra logging and debugging", false)
	.action(run)
	.parse(process.argv);
