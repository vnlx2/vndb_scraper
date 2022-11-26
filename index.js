import VNDB from 'vndb-api';
const vndb = new VNDB('atri_api');
import mongoose from "mongoose";
import { config } from "dotenv";
import model from './VNDBModel.js';
import fs from 'fs';

config();

mongoose.connect(process.env.MONGODB_URI, {
	useNewUrlParser: true,
	useUnifiedTopology: true
});

const init_db = () =>
	mongoose.connection
		.on('error', (error) => console.error(error))
		.once('open', () => console.log('Database Connected'));

async function get_vn_by_code(code)
{
	return await vndb.query(`get vn details,basic,stats (id = ${code})`);
}

async function insert_to_db(result)
{
	const body = {
		code: result.id,
		title: result.title,
		alias: result.alias,
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
	if (fs.existsSync('./vn-stats.json')) {
		const jsonVal = require('./vn-stats.json');
		return jsonVal['last_vn_id'];
	}

	return 1;
}

async function main()
{
	init_db();

	let code = 40029;
	let i;

	i = code - 5;
	while (i++) {
		console.log(`Scraping VN ${i}...`);
		let ret = await scrape_vn_and_save_to_db(i);
		if (!ret)
			break;
		console.log(`Successfully scraped VN ${i}`);
	}
	console.log(`Last VN ID is ${code}`);
	save_last_id(i);
	process.exit();
}

main();