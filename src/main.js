const fs = require('fs');
const path = require('path');
const YAML = require('yaml');
const cheerio = require('cheerio');
const request = require('request-promise');

const root = 'https://codeforces.com';
const config = YAML.parse(fs.readFileSync(path.join(__dirname, '../config.yml')).toString())
const template = fs.readFileSync(path.join(__dirname, '../README.template.md')).toString();

async function fetch(uri, query = '') {
	if (!uri.startsWith('/')) {
		uri = '/' + uri;
	}
	const cache_filename = encodeURIComponent(uri.slice(1)) + '.html';
	const cache_filedir = path.join(__dirname, '../tmp/' + cache_filename);

	if (fs.existsSync(cache_filedir)) {
		const cache_content = (await fs.promises.readFile(cache_filedir)).toString();
		return cheerio.load(cache_content);
	} else {
		const html = await request({
			uri: root + uri + query,
			timeout: 10000,
		});
		await fs.promises.writeFile(cache_filedir, html);
		return cheerio.load(html);
	}
}

async function crawlGym(id) {
	const $ = await fetch(`/gym/${id}`);
	const data = {};

	data.title = $('#sidebar .rtable tr').eq(0).text().trim();
	data.materials = Array.from($('.sidebar-menu li').map(function () {
		return $(this).text().trim();
	}));

	return data;
}

async function crawlStandings(id) {
	const $ = await fetch(`/gym/${id}/standings`);
	return Array.from($('.standings tr:not(:first-child):not(:last-child)').map(function () {
		return $($(this).children('td')[1]).text().trim();
	}));
}

async function crawl() {
	const id_set = new Set();
	async function collect(uri) {
		const $ = await fetch(uri, config.query);
		$('.datatable table tr').each(function () {
			const id = $(this).attr('data-contestid');
			if (id) {
				id_set.add(id);
			}
		});
	}
	for (let page = 1; page <= 5; page++) {
		await collect(`/gyms/page/${page}`);
	}

	let gyms = [];
	for (const id of Array.from(id_set)) {
		const [data, standings] = await Promise.all([
			crawlGym(id),
			crawlStandings(id),
		]);
		data.id = id;
		data.standings = standings;
		data.friends = standings.filter((teamname) => {
			teamname = teamname.toLowerCase();
			for (const not_friend of config.not_friends) {
				if (teamname.includes(not_friend.toLowerCase())) { return false; }
			}
			for (const friend of config.friends) {
				if (teamname.includes(friend.toLowerCase())) { return true; }
			}
			return false;
		});
		console.log('crawling', id + ':', data.title);
		gyms.push(data);
	}

	gyms = gyms.filter((data) => {
		let legal = !!data.standings.length;
		let has_solution = false;
		for (const material of data.materials) {
			if (material.toLowerCase().includes('(en)') || material.toLowerCase().includes('(ch)')) {
				if (material.toLowerCase().includes('solution')) { has_solution = true; }
				if (material.toLowerCase().includes('tutorial')) { has_solution = true; }
				if (material.toLowerCase().includes('editorial')) { has_solution = true; }
			}
		}
		let has_friends = !!data.friends.length;

		return legal && has_solution && has_friends;
	});

	for (const gym of gyms) {
		console.log(gym.id + ':', gym.title);
	}
	console.log('count:', gyms.length);

	let table = '|Contest|Friends|\n|:-:|:-:|\n';
	for (const gym of gyms) {
		table += `|[${gym.title}](https://codeforces.com/gym/${gym.id})<br>(${gym.id})|`;
		for (let i = 0; i < gym.friends.length; i++) {
			table += '<li>' + gym.friends[i] + '</li>';
		}
		table += '|\n';
	}

	let markdown = template;
	markdown = markdown.replace('{{ table }}', table);
	markdown = markdown.replace('{{ length }}', '' + gyms.length);
	await fs.promises.writeFile(path.join(__dirname, '../README.md'), markdown);
}

async function main(force = false) {
	do {
		try {
			await crawl();
			return;
		} catch (e) {
			console.error(e);
		}
	} while (force);
}

main();