#!/usr/bin/env node

import path from "path";
import { writeFile, mkdir } from "fs/promises";
import sade from "sade";
import { collectStats } from "../src/index.js";

async function run(url, opts) {
	const results = await collectStats(url);
	const resultJSON = JSON.stringify(results, null, 2);

	const outputFile = path.isAbsolute(opts.output)
		? opts.output
		: path.join(process.cwd(), opts.output);

	await mkdir(path.dirname(outputFile), { recursive: true });
	await writeFile(outputFile, resultJSON, "utf8");
}

sade("react-stats [file]", true)
	.describe("Collect stats about React usage on a website")
	.example("https://facebook.com")
	.option("-o --output", "File to output results to", "react-stats.json")
	.action(run)
	.parse(process.argv);
