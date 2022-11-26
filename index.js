import VNDB from 'vndb-api';
const vndb = new VNDB('atri_api');
import mongoose from "mongoose";
import { config } from "dotenv";
import model from './VNDBModel.js';
import fs from 'fs';

config();

async function get_vn_by_code(code)
{
	return await vndb.query(`get vn details,basic,stats (id = ${code})`);
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

async function insert_to_db(result)
{
	const body = {
		code: result.id,
		title: result.title,
		aliases: result.aliases,
		length: result.length,
		rating: result.rating,
		description: result.image,
		image: result.image
	};
	const response = await model(body);
	await response.save();
}

async function scrape_vn_and_save_to_db(code)
{
	const result = await get_vn_by_code(code);
	if (!result) {
		console.log("Internal error");
		return false;
	}

	if (result.items.length == 0) {
		console.log(`VN ${code} is not found`);
		return false;
	}

	insert_to_db(result.items[0]);
	return true;
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

	while (true) {
		let nr_vns_ours = get_number_of_our_vns();
		let nr_vns_vndb = get_number_of_vndb_vns();

		if (nr_vns_vndb == nr_vns_ours)
			break;

		console.log(`Scraping VN ${i}...`);
		let ret = await scrape_vn_and_save_to_db(i);
		if (!ret) {
			console.log(`Failed to scrape VN ${i}`);
			i++;
			continue;
		}

		console.log(`Successfully scraped VN ${i}`);
		save_last_id(i);
		i++;
		await sleep(1000);
	}
	process.exit();
}

function main()
{
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
