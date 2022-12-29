import VNDB from 'vndb-api';
const vndb = new VNDB('atri_api');
import mongoose from "mongoose";
import { config } from "dotenv";
import model from './VNDBModel.js';
import fs from 'fs';
import logger from './logger.js';

config();

async function get_vn_by_code(codes)
{
	try {
		return await vndb.query(`get vn details,basic,stats (id = [${codes}])`);
	} catch (err) {
		console.error(err);
	}
}

async function get_number_of_vndb_vns()
{
	let res = await vndb.query("dbstats");

	if (!("vn" in res))
		throw Error("Error, vndb malformed response");
	return res.vn;
}

async function get_number_of_our_vns()
{
	return await model.countDocuments();
}

async function insert_to_db(results, currentCode, errorCounter)
{
	const documents = [];
	let lastCode = currentCode;
	for(const result of results) {
		logger.info(`Processing ${result.id} and current code is ${currentCode}`);
		while(parseInt(currentCode) < parseInt(result.id)) {
			console.log(`Failed to scrape VN ${currentCode}`);
			logger.error(`Failed to scrape ${currentCode}`);
			currentCode++;
			errorCounter++;
		}
		const body = {
			code: result.id,
			title: result.title,
			aliases: result.aliases,
			length: result.length,
			rating: result.rating,
			description: (!result.description) ? '-' : result.description,
			image: result.image
		};
		documents.push(body);
		lastCode = currentCode;
		currentCode++;
	}
	/** 
	 * When lastCode not reach multiple 10, return error
	 * and add 1 to lastCode
	*/  
	if(lastCode % 10) {
		lastCode++;
		console.log(`Failed to scrape VN ${lastCode}`);
		logger.error(`Failed to scrape ${currentCode}`);
		errorCounter++;
	}

	// Store vn data and return lastCode
	const response = model;
	await response.insertMany(documents);
	logger.info(`Last Code after scrap ${lastCode} and error counter ${errorCounter}`);
	return {lastCode: lastCode, errorCounter: errorCounter};
}

async function scrape_vn_and_save_to_db(lastCode, remainsVN, errorCounter)
{
	// Generate vndb code sequences
	const length = (remainsVN >= 10) ? 10 : remainsVN;

	console.log(`Scraping VN ${lastCode} - ${lastCode + length - 1}...`);
	logger.info(`Scraping VN ${lastCode} - ${lastCode + length - 1}...`);

	const codes = [...Array(length).keys()].map(code => code + lastCode);

	// Get VN data
	const response = await get_vn_by_code(codes);
	if (!response) {
		console.log("Internal error");
		return {
			status: false,
			lastCode: lastCode,
			errorCounter: errorCounter,
		};
	}
	logger.info(`Total of success vn scrap: ${response.length}`);

	const result = await insert_to_db(response.items, lastCode, errorCounter);
	return {
		status: true,
		lastCode: result.lastCode,
		errorCounter: result.errorCounter,
	};
}

function save_last_id_and_error_counter(id, error_count=0)
{
	const jsonVal = {
		last_vn_id: id,
		error_count: error_count
	};
	fs.writeFileSync('vn-stats.json', JSON.stringify(jsonVal)+"\n");
	return true;
}

function get_last_id_and_error_counter()
{
	if (!fs.existsSync('./vn-stats.json'))
		return {lastVNId: 0, errorCount: 0};

	const jsonVal = fs.readFileSync('./vn-stats.json');
	let ret = JSON.parse(jsonVal);
	if ((!("last_vn_id" in ret) || isNaN(ret.last_vn_id)) &&
		(!("error_count" in ret) || isNaN(ret.error_count)))
		return {lastVNId: 0, errorCount: 0};

	return {lastVNId: ret.last_vn_id, errorCount: ret.error_count};
}

function sleep(ms)
{
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

async function start_scrape()
{
	const lastIdAndErrorCounter = get_last_id_and_error_counter();
	let i = lastIdAndErrorCounter.lastVNId + 1;
	let errorCount = lastIdAndErrorCounter.errorCount;
	let nr_vns_vndb = await get_number_of_vndb_vns();

	while (true) {
		let nr_vns_ours = await get_number_of_our_vns();
		let remains = nr_vns_vndb - nr_vns_ours;

		logger.info(`VN Stat : { 
			our_vn_count: ${nr_vns_ours}, vndb_count: ${nr_vns_vndb}, 
			remains: ${remains} }`);

		if (nr_vns_vndb == nr_vns_ours)
			break;
		let ret = await scrape_vn_and_save_to_db(i, remains, 
			errorCount);

		console.log(`Successfully scraped VN ${i} - ${ret.lastCode}`);
		logger.info(`Successfully scraped VN ${i} - ${ret.lastCode}`);
		console.log(`Status (${i} - ${ret.lastCode}) : ${ret.lastCode} - ${ret.errorCounter}`);
		save_last_id_and_error_counter(ret.lastCode, ret.errorCounter);
		i = ret.lastCode + 1;
		errorCount = ret.errorCounter;
		await sleep(1000);
	}
	process.exit();
}

function main()
{
	console.log(`VNDB Scraper ${process.env.VERSION}`);
	mongoose.connect(process.env.MONGODB_URI, {
		useNewUrlParser: true,
		useUnifiedTopology: true
	});

	mongoose.connection
		.on('error', (error) => console.error(error))
		.once('open', async function () {
			console.log('Database Connected');
			await start_scrape();
		});
}

main();
