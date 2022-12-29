import VNDB from 'vndb-api';
const vndb = new VNDB('atri_api');
import mongoose from "mongoose";
import { config } from "dotenv";
import model from './VNDBModel.js';
import fs from 'fs';

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

async function insert_to_db(results, currentCode)
{
	const documents = [];
	let lastCode = currentCode;
	for(const result of results) {
		while(parseInt(currentCode) < parseInt(result.id)) {
			console.log(`Failed to scrape VN ${currentCode}`);
			currentCode++;
		}
		console.log(`Create body for VN ${currentCode}`);
		console.log(`Description ${currentCode} : ${result.description}`);
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
	}

	// Store vn data and return lastCode
	const response = model;
	await response.insertMany(documents);
	return lastCode;
}

async function scrape_vn_and_save_to_db(lastCode, remainsVN)
{
	// Generate vndb code sequences
	const length = (remainsVN >= 10) ? 10 : remainsVN;
	console.log(`Scraping VN ${lastCode} - ${lastCode + length - 1}...`);
	const codes = [...Array(length).keys()].map(code => code + lastCode);

	// Get VN data
	const result = await get_vn_by_code(codes);
	if (!result) {
		console.log("Internal error");
		return {
			status: false,
			lastCode: lastCode
		};
	}

	lastCode = await insert_to_db(result.items, lastCode);
	return {
		status: true,
		lastCode: lastCode
	};
}

function save_last_id(id)
{
	const jsonVal = {
		last_vn_id: id
	};
	fs.writeFileSync('vn-stats.json', JSON.stringify(jsonVal)+"\n");
	return true;
}

function get_last_id()
{
	if (!fs.existsSync('./vn-stats.json'))
		return 0;

	const jsonVal = fs.readFileSync('./vn-stats.json');
	let ret = JSON.parse(jsonVal);
	if (!("last_vn_id" in ret) || isNaN(ret.last_vn_id))
		return 0;

	return ret.last_vn_id
}

function sleep(ms)
{
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

async function start_scrape()
{
	let i = get_last_id() + 1;
	let nr_vns_vndb = await get_number_of_vndb_vns();

	while (true) {
		let nr_vns_ours = await get_number_of_our_vns();
		let remains = nr_vns_vndb - nr_vns_ours;

		if (nr_vns_vndb == nr_vns_ours)
			break;
		let ret = await scrape_vn_and_save_to_db(i, remains);
		console.log(`Successfully scraped VN ${i} - ${ret.lastCode}`);
		save_last_id(ret.lastCode);
		i = ret.lastCode + 1;
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
