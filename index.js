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

async function insert_to_db(results, currentCode, progressBar)
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
		progressBar.increment();
		currentCode++;
	}

	// Store vn data and return last code and error counter
	try {
		const response = model;
		await response.insertMany(documents, {ordered : false });
	} catch (err) {
		progressBar.stop();
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

async function scrape_vn_and_save_to_db(lastCode, remainsVN, batchesNumber, errorCount)
{
	console.info('\nStart Scraping')
	
	try {
		// Start timer calculation
		let start = performance.now();

		for (let batchNumber = 0; batchNumber < batchesNumber; batchNumber++) {
			// Initialize progress bar
			const progressBar = new cliProgress.SingleBar({
				clearOnComplete: false,
				hideCursor: false,
				format: ' {bar} | Batch : {batchNumber} | ETA : {eta}s | {value}/{total} | {startCode}/{endCode}'
			}, cliProgress.Presets.legacy);

			// Calculate target size of batch
			const targetSize = (remainsVN >= 10) ? 10 : remainsVN;

			// Generate array of codes based from last code to last code + targetSize
			let batchCodes = [...Array(targetSize).keys()].map(code => code + lastCode);
	
			// Scrap from vndb
			console.log(`\nFetching batch ${batchNumber+1} from VNDB...`);
			progressBar.start(targetSize, 0, {
				batchNumber: batchNumber+1,
				startCode: lastCode,
				endCode: '-'
			});
			let batchResult = await get_vn_by_code(batchCodes);

			if (!batchResult) {
				console.log("Internal error");
				save_last_id_and_error_counter(lastCode, errorCount);
				progressBar.stop();
				break;
			}			
			batchResult = batchResult.items;
			logger.info(`Total of success vn scraped [Code ${batchCodes[0]} - ${batchCodes[batchCodes.length-1]}] : ${batchResult.length}`);

			// When batch result's size not reach target size, generate array of code
			// with length equal to sum of remains of target size. and scrap it
			// until batch result's size equals with target size.
			while (batchResult.length < targetSize) {
				const batchResultLength = batchResult.length;
				batchCodes = [...Array(targetSize - batchResultLength).keys()]
					.map(code => code + (batchCodes[batchCodes.length - 1] + 1));
				const additionalBatchResult = await get_vn_by_code(batchCodes);
				if (additionalBatchResult.items.length > 0) {
					batchResult = [...batchResult, ...additionalBatchResult.items];
				}
			}

			// Update end code with last code from batch result
			progressBar.update(0, {
				endCode: batchResult[length-1].id
			});

			// Store batch result to database and store last code
			// then pause it for a second.
			lastCode = await insert_to_db(batchResult, lastCode, progressBar);
			save_last_id_and_error_counter(lastCode);
			remainsVN -= length;
			await sleep(1000);
		}
		// Return the length of time required for scraping
		return performance.now() - start;
	} catch (err) {
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
	console.log('\nChecking new update');
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

	if (remains === 0) {
		console.info('Database updated');
		return;
	}

	console.info(`There are ${remains} new vn that not added.`);
	logger.info(`VN Stat : { 
		our_vn_count: ${nr_our_vns}, vndb_count: ${nr_vns_vndb}, 
		remains: ${remains} }`);
	
	// Calculate batch
	const batches = Math.ceil(remains / 10);
	console.info(`Scraping in ${batches} batches`);

	// Execution
	try {
		const timer = await scrape_vn_and_save_to_db(lastCode, remains, batches,
			errorCount);	
		console.log('\n\nScraping VN Finished');

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
