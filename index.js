import VNDB from 'vndb-api';
const vndb = new VNDB('atri_api');
import mongoose from "mongoose";
import { config } from "dotenv";
import model from './VNDBModel.js';
import fs from 'fs';
import logger from './logger.js';
import cliProgress from 'cli-progress';
import { schedule } from 'node-cron';

config();

async function get_vn_by_code(codes)
{
	try {
		return await vndb.query(`get vn details,basic,stats (id = [${codes}])`);
	} catch (err) {
		console.error(err);
	}
}

async function insert_to_db(results, currentCode)
{
	const documents = [];

	// Add result to model
	for(const result of results) {
		logger.info(`Processing ${result.id} and current code ${currentCode}`);
		while(parseInt(currentCode) < parseInt(result.id)) {
			logger.error(`VN with code ${currentCode} not found`);
			currentCode++;
		}
		const body = {
			code: result.id,
			title: result.title,
			aliases: (result.aliases != null) ? result.aliases.split(/\r?\n/) : null,
			length: result.length,
			rating: result.rating,
			description: (!result.description) ? '-' : result.description,
			image: result.image
		};
		documents.push(body);
		currentCode++;
	}

	// Store vn data and return last code and error counter
	try {
		const response = model;
		await response.insertMany(documents, {ordered : false });
	} catch (err) {
		throw err;
	}
	return currentCode;
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

function sleep(ms)
{
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

async function scrape_vn_and_save_to_db(lastCode, remainsVN, batch, errorCount)
{
	const progressBar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
	progressBar.start(batch, 0);

	try {
		let start = performance.now();
		while (batch > 0) {
			const length = (remainsVN >= 10) ? 10 : remainsVN;
			// Generate array of codes based from last code to last code + length
			const codes = [...Array(length).keys()].map(code => code + lastCode);
	
			// Scrap from vndb
			const response = await get_vn_by_code(codes);
			if (!response) {
				console.log("Internal error");
				save_last_id_and_error_counter(lastCode, errorCount);
				progressBar.stop();
				break;
			}
			logger.info(`Total of success vn scraped: ${response.items.length}`);
			
			// Store to db
			lastCode = await insert_to_db(response.items, lastCode);
			save_last_id_and_error_counter(lastCode);
			batch--;
			remainsVN -= length;
			progressBar.increment();
			await sleep(1000);
		}
		return performance.now() - start;
	} catch (err) {
		progressBar.stop();
		throw err;
	}
}

function get_last_id_and_error_counter()
{
	if (!fs.existsSync('./vn-stats.json'))
		return {lastVNId: 0, errorCount: 0};

	const jsonVal = fs.readFileSync('./vn-stats.json');
	let ret = JSON.parse(jsonVal);
	if ((!("last_vn_id" in ret) || isNaN(ret.last_vn_id)) &&
		(!("error_count" in ret) || isNaN(ret.error_count)))
		return {lastVNId: 1, errorCount: 0};

	return {lastVNId: ret.last_vn_id, errorCount: ret.error_count};
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

async function start_scrape()
{
	console.log('\nStart Scraping');
	// Get Last VN Code and Error Counter
	const lastIdAndErrorCounter = get_last_id_and_error_counter();
	let lastCode = lastIdAndErrorCounter.lastVNId;
	let errorCount = lastIdAndErrorCounter.errorCount;

	// Count remains vn that not inserted to database
	const nr_vns_vndb = await get_number_of_vndb_vns();
	const nr_our_vns = await get_number_of_our_vns();
	let remains = nr_vns_vndb - nr_our_vns;
	
	if (nr_our_vns === 0) {
		lastCode = 1;
		errorCount = 0;
	}

	console.info(`There are ${remains} vn that not added.`);
	logger.info(`VN Stat : { 
		our_vn_count: ${nr_our_vns}, vndb_count: ${nr_vns_vndb}, 
		remains: ${remains} }`);
	
	// Calculate batch
	const batches = Math.ceil(remains / 10);

	// Execution
	try {
		const timer = await scrape_vn_and_save_to_db(lastCode, remains, batches,
			errorCount);	
		console.log('\n\nScraping VN Success');

		const current_nr_our_vns = await get_number_of_our_vns();
		console.log(`Success : ${current_nr_our_vns - nr_our_vns}`);
		console.log(`Failed  : ${nr_vns_vndb - current_nr_our_vns}`);
		console.log(`Timer   : ${((timer - (1000 * (batches - 1))) / 1000).toFixed(2)} seconds`);
		logger.info(`Success : ${current_nr_our_vns - nr_our_vns} ; Failed : ${nr_vns_vndb - current_nr_our_vns}`);
	} catch (err) {
		console.error('An error was occured.');
		console.error(err);
		logger.error(err);
	}
}

function main()
{
	console.log(`VNDB Scraper ${process.env.VERSION}`);
	console.log('Visual Novel Lovers - 2023\n');
	mongoose.connect(process.env.MONGODB_URI, {
		useNewUrlParser: true,
		useUnifiedTopology: true
	});

	mongoose.connection
		.on('error', (error) => console.error(error))
		.once('open', async function () {
			console.log('[Info] : Database Connected');
			logger.info('Database Connected');
			schedule('0 0 * * *', async () => await start_scrape(), {
				scheduled: true,
				timezone: "Asia/Jakarta"
			});
		});
}

main();
