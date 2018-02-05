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

// ----------------------------------------------------------------- game/list
router.get('/game/list', function(req, res, next) {
	const query = `SELECT * FROM games ORDER BY
		title_english ASC,
		title_romaji ASC,
		title_jp ASC;`;

	pgPool.query(query, function(err, res2) {
		if (err) {
			console.error(err);

			res.render('game/list', {
				title: websiteName + ' // games',
				error: 'Something went wrong; please try again' });
		}
		else {
			res.render('game/list', {
				title: websiteName + ' // games',
				games: res2.rows });
		}
	});
});

// ----------------------------------------------------------------- game/view
router.get('/game/view/:id', function(req, res, next) {
	// Get all the information on the game, as well as its related screenshots
	const query = `SELECT *,
		array(SELECT url FROM screenshots WHERE game_id = $1) AS ss_urls
		FROM games WHERE id = $1;`;

	const vars = [ req.params.id ];

	pgPool.query(query, vars, function(err, res2) {
		if (err) {
			console.error(err);

			res.render('game/view', {
				title: websiteName + ' // game',
				error: 'Something went wrong; please try again',
				game: {} });
		}
		else if (!res2.rows.length) {
			res.render('game/view', {
				title: websiteName + ' // game',
				error: 'No entry with that ID exists',
				game: {} });
		}
		else {
			// TODO: Show game title in window title
			res.render('game/view', {
				title: websiteName + ' // game',
				game: res2.rows[0] });
		}
	});
});

// ----------------------------------------------------------------- game/new
router.get('/game/new', function(req, res, next) {
	res.render('game/new', {
		title: websiteName + ' // new entry',
		form: {} });
});

/**
 * Saves a game entry to the database.
 *
 * @param {dict} form - Information about the game (from a form).
 * @param {function(bool)} callback - The callback function.
 */
function saveGameEntry(form, callback) {
	const query = `INSERT INTO games (
		title_jp,
		title_romaji,
		title_english,
		title_english_official,
		title_other,
		entry_created ) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id;`;

	const vars = [
		form.title_jp,
		form.title_romaji,
		form.title_english,
		form.title_english_official ? 'TRUE' : 'FALSE',
		form.title_other,
		new Date(new Date().getTime()).toISOString() ];

	pgPool.query(query, vars, function(err, res) {
		if (err) {
			console.error(err);
			callback(false, 0);
		}
		else {
			callback(true, res.rows[0].id);
		}
	});
}

/**
 * Saves a list of screenshots to the database.
 *
 * @param {array} screenshots - An array of screenshot URLs.
 * @param {int} gameId - The ID of the game the screenshot is related to.
 */
function saveScreenshots(screenshots, gameId) {
	// Form the query string
	let query = 'INSERT INTO screenshots (url, game_id) VALUES';
	let vars = [ gameId ];
	let n = 1;

	screenshots.forEach(function(ss) {
		n++;
		if (n > 2) {
			query += ',';
		}

		query += ' ($' + n + ', $1)';
		vars.push(ss);
	});

	query += ';';

	// Query the database
	pgPool.query(query, vars, function(err, res) {
		if (err) {
			console.error(err);
		}
	});
}

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
		// Parse the list of screenshots
		let screenshotsValidated = [];

		if (form.screenshots) {
			// textareas use \r\n for newlines it seems
			const screenshots = form.screenshots.split('\r\n');

			// Validate that each given string is an image URL
			screenshots.forEach(function(ss) {
				if ( /^https?:\/\/.+\.(gif|png|jpg|jpeg)$/i.test(ss) ) {
					screenshotsValidated.push(ss);
				}
				else {
					error = 'At least one of the screenshot URLs is invalid';
					return;
				}
			});
		}

		// If an error occurred while validating the screenshot URLs, we skip this
		if (!error) {
			saveGameEntry(form, function(success, gameId) {
				if (success) {
					saveScreenshots(screenshotsValidated, gameId);
					res.redirect('/game/view/' + gameId);
				}
				else {
					error = 'Something went wrong; please try again';
				}
			});
		}
	}

	if (error) {
		res.render('game/new', {
			title: websiteName + ' // new entry',
			error: error,
			form: form });
	}
});

module.exports = router;
