const config = require('../config');

const express = require('express');
const router = express.Router();

const websiteName = 'DGDB';

// ================================================================= Database
const pg = require('pg');
let pgPool;

if (process.env.DATABASE_URL) {
	const params = url.parse(process.env.DATABASE_URL);
	const auth = params.auth.split(':');

	const pgConfig = {
		host: params.hostname,
		port: params.port,
		user: auth[0],
		password: auth[1],
		database: params.pathname.split('/')[1],
		ssl: config.db.ssl,
		max: config.db.max,
		idleTimoutMillis: config.db.idleTimoutMillis };

	pgPool = new pg.Pool(pgConfig);
}
else {
	pgPool = new pg.Pool(config.db);
}

pgPool.on('error', function(err, client) {
	console.error('Idle client error: ', err.message, err.stack);
});

// ================================================================= Routing
router.get('/', function(req, res, next) {
	res.render('index', {
		title: websiteName + ' // home' });
});

router.get('/game/new', function(req, res, next) {
	res.render('game/new', {
		title: websiteName + ' // new entry',
		form: {} });
});

router.post('/game/new', function(req, res, next) {
	const form = req.body;
	let error = '';

	// Ensure that the user hasn't bypassed the character limits
	if (form.title_jp.length      > 100 ||
		form.title_romaji.length  > 100 ||
		form.title_english.length > 100 ||
		form.title_other.length   > 100) {
			error = 'Bypassing the character limit is bad!';
		}

	// Ensure that at least one title has been entered
	else if (!form.title_jp && !form.title_romaji && !form.title_english) {
		error = 'At least one title is required (abbreviations don\'t count)';
	}

	else {
		const query = `INSERT INTO games (
			title_jp,
			title_romaji,
			title_english,
			title_english_official,
			title_other,
			entry_created ) VALUES ($1, $2, $3, $4, $5, $6);`;

		const vars = [
			form.title_jp,
			form.title_romaji,
			form.title_english,
			form.title_english_official ? 'TRUE' : 'FALSE',
			form.title_other,
			new Date(new Date().getTime()).toISOString() ];

		pgPool.query(query, vars, function(err, res2) {
			if (err) {
				console.error(err);

				res.render('game/new', {
					title: websiteName + ' // new entry',
					error: 'Something went wrong; please try again',
					form: form });
			}
			else {
				res.redirect('/');
			}
		});
	}

	if (error) {
		res.render('game/new', {
			title: websiteName + ' // new entry',
			error: error,
			form: form });
	}
});

module.exports = router;
