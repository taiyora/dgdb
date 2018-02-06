// Try to load the config file; it's fine if it doesn't load (e.g. on Heroku)
let config;
let configLoaded = true;

try {
	config = require('../config');
}
catch (e) {
	console.log('Config file couldn\'t be found; continuing without it...');
	configLoaded = false;
}

const bcrypt = require('bcrypt');
const url    = require('url');

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
		ssl: configLoaded ? config.db.ssl : true,
		max: configLoaded ? config.db.max : 10,
		idleTimoutMillis: configLoaded ? config.db.idleTimoutMillis : 30000 };

	pgPool = new pg.Pool(pgConfig);
}
else if (configLoaded) {
	pgPool = new pg.Pool(config.db);
}
else {
	console.error('Can\'t connect to database: no config could be found!');
}

pgPool.on('error', function(err, client) {
	console.error('Idle client error: ', err.message, err.stack);
});

// Create a necessary SQL function
const query = `CREATE OR REPLACE FUNCTION
upsert_ratings(uid integer, gid integer, new_rating real) RETURNS VOID AS $$
	DECLARE
	BEGIN
		UPDATE ratings SET rating = new_rating
			WHERE user_id = uid AND game_id = gid;
		IF NOT FOUND THEN
		INSERT INTO ratings (user_id, game_id, rating)
			VALUES (uid, gid, new_rating);
		END IF;
	END;
	$$ LANGUAGE 'plpgsql';`;

pgPool.query(query, function(err, res) {
	if (err) {
		console.error(err);
	}
});

// ================================================================= Sessions
const sessions = require('client-sessions');
const keygen   = require('generate-key');

router.use(sessions({
	cookieName: 'session',
	secret: keygen.generateKey(60),
	duration: 1000 * 60 * 60 * 25, // One day
	activeDuration: 1000 * 60 * 60 * 25,
	httpOnly: true, // Prevents clients from using JavaScript to access cookies
	secure: true })); // Ensures that cookies are only sent over HTTPS

// res.session.user is the logged in user's username.
// res.locals contains the user's full details
router.use(function(req, res, next) {
	if (req.session && req.session.user) {
		const query = 'SELECT * FROM users WHERE username = $1';
		const vars = [ req.session.user ];

		pgPool.query(query, vars, function(err, res2) {
			if (err) {
				console.error(err);
			}
			else if (res2.rows.length) {
				res.locals.user = res2.rows[0];
				delete res.locals.user.pw_hash;
				req.user = res.locals.user;
			}

			next();
		});
	}
	else {
		next();
	}
});

/**
 * Ensures that a user is logged in before progressing.
 *
 * @param {dict} req - req.
 * @param {dict} res - res.
 * @param {dict} next - next.
 */
function requireLogin(req, res, next) {
	if (req.session.user) {
		next();
	}
	else {
		res.redirect('/account/login');
	}
}

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
	// Get all the information on the game, as well as its related screenshots.
	// ss_urls: A list of screenshots associated with the game.
	// ratings: A list of every user's rating for the game.
	// user_rating: The rating that the logged in user gave the game.
	const query = `SELECT *,
		array(SELECT url FROM screenshots WHERE game_id = $1) AS ss_urls,
		array(SELECT rating FROM ratings WHERE game_id = $1) AS ratings,
		(SELECT rating FROM ratings where game_id = $1 AND user_id = $2)
			AS user_rating
		FROM games WHERE id = $1;`;

	const vars = [
		req.params.id,
		res.locals.user ? res.locals.user.id : 0 ];

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

router.post('/game/updateRating', requireLogin, function(req, res, next) {
	const form = req.body;

	// Make sure that the given rating has only one decimal place
	let rating = Math.round(form.user_rating * 10) / 10;

	// Ensure that rating is within bounds
	if (rating < 1 || rating > 10) {
		res.send('failure');
		return;
	}

	const query = `SELECT upsert_ratings($1, $2, $3);`;
	const vars = [
		res.locals.user ? res.locals.user.id : 0,
		form.game_id,
		rating ];

	pgPool.query(query, vars, function(err, res2) {
		if (err) {
			console.error(err);
		}
		else {
			res.send('success');
		}
	});
});

// ----------------------------------------------------------------- game/new
router.get('/game/new', requireLogin, function(req, res, next) {
	res.render('game/new', {
		title: websiteName + ' // new entry',
		form: {} });
});

/**
 * Saves a game entry to the database.
 *
 * @param {dict} form - Information about the game (from a form).
 * @param {function(bool, int)} callback - The callback function.
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
					res.render('game/new', {
						title: websiteName + ' // new entry',
						error: 'Something went wrong; please try again',
						form: form });
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

// ----------------------------------------------------------------- account/
router.get('/account/login', function(req, res, next) { //           login
	if (req.session.user) {
		res.redirect('/');
	}
	else {
		res.render('account/login', {
			title: websiteName + ' // login',
			form: {} });
	}
});

router.post('/account/login', function(req, res, next) {
	const form = req.body;
	let error = '';

	if (!form.username || !form.password) {
		error = 'A required field was left blank';
	}
	else if (form.username.length > 20 || form.password.length > 100) {
		error = 'Bypassing the character limit is bad!';
	}
	else {
		const query = 'SELECT * FROM users WHERE username = $1;';
		const vars = [ form.username ];

		pgPool.query(query, vars, function(err, res2) {
			if (err) {
				console.error(err);
				error = 'Something went wrong; please try again';
			}
			else if (res2.rows.length <= 0) {
				error = 'No user with that username exists';
			}
			else {
				if (bcrypt.compareSync(form.password, res2.rows[0].pw_hash)) {
					req.session.user = form.username;
					res.redirect('/');
				}
				else {
					error = 'Invalid credentials';
				}
			}

			if (error) {
				res.render('account/login', {
					title: websiteName + ' // login',
					error: error,
					form: form });
			}
		});
	}

	if (error) {
		res.render('account/login', {
			title: websiteName + ' // login',
			error: error,
			form: form });
	}
});

// ----------------------------------------------------------------- account/
router.get('/account/logout', function(req, res, next) { //          logout
	req.session.reset();
	res.redirect('/');
});

// ----------------------------------------------------------------- account/
router.get('/account/register', function(req, res, next) { //        register
	if (req.session.user) {
		res.redirect('/');
	}
	else {
		res.render('account/register', {
			title: websiteName + ' // register',
			form: {} });
	}
});

/**
 * Ensures that an string contains only plaintext.
 * Used to validate usernames.
 *
 * @param {string} text - The text.
 * @return {bool} - true if the text is plaintext, false otherwise.
 */
function isPlainText(text) {
	const regex = /^[a-zA-Z0-9]*$/;
	return regex.test(text);
}

/**
 * Ensures that an string contains only ASCII.
 * Used to validate passwords.
 *
 * @param {string} text - The text.
 * @return {bool} - true if the text is entirely ASCII, false otherwise.
 */
function isAscii(text) {
	const regex = /^[\x20-\x7e]*$/;
	return regex.test(text);
}

/**
 * Checks whether the specified username already exists in the database.
 *
 * @param {string} username - The username.
 * @param {function(bool)} callback - The callback function.
 */
function doesUsernameExist(username, callback) {
	const query = 'SELECT * FROM users WHERE username = $1;';
	const vars = [ username ];

	pgPool.query(query, vars, function(err, res) {
		if (err) {
			console.error(err);
			callback(true);
		}
		else {
			callback(res.rows.length > 0);
		}
	});
}

/**
 * Registers a new user in the database.
 *
 * @param {dict} user - The user's details.
 * @param {dict} res - So that .render can be accessed.
 */
function registerUser(user, res) {
	// Hash the password before saving it to the database
	const salt = bcrypt.genSaltSync(10);
	const hash = bcrypt.hashSync(user.password, salt);

	const query = 'INSERT INTO users (username, pw_hash) VALUES ($1, $2);';
	const vars = [
		user.username,
		hash ];

	pgPool.query(query, vars, function(err, res2) {
		if (err) {
			console.error(err);

			res.render('account/register', {
				title: websiteName + ' // register',
				error: 'Something went wrong; please try again',
				form: user });
		}
		else {
			res.render('account/login', {
				title: websiteName + ' // login',
				message: 'Account created! You may now login',
				form: user });
		}
	});
}

router.post('/account/register', function(req, res, next) {
	const form  = req.body;
	let error = '';

	if (!form.username || !form.password) {
		error = 'A required field was left blank';
	}
	else if (form.username.length < 3 || form.username.length > 20) {
		error = 'Username must be between 3 and 20 characters long (inclusive)';
	}
	else if (!isPlainText(form.username)) {
		error = 'Username must use only plain text characters (a-z, A-Z, 0-9)';
	}
	else if (form.password.length < 10 || form.password.length > 100) {
		error = 'Password must be between 10 and 100 characters long (inclusive)';
	}
	else if (!isAscii(form.password)) {
		error = 'Password must use only ASCII characters';
	}
	else {
		doesUsernameExist(form.username, function(exists) {
			if (exists) {
				res.render('account/register', {
					title: websiteName + ' // register',
					error: 'Username is taken',
					form: form });
			}
			else {
				registerUser(form, res);
			}
		});
	}

	if (error) {
		res.render('account/register', {
			title: websiteName + ' // register',
			error: error,
			form: form });
	}
});

module.exports = router;
