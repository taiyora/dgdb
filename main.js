/**
 * @module main
 * Defines constants and functions that are used throughout the app by multiple
 * routers.
 */

// eslint-disable-next-line max-len
// ================================================================================================================================== Globals
const websiteName = 'DGDB';

// eslint-disable-next-line max-len
// ================================================================================================================================== General
/**
 * We store timestamps in the database as ISO strings, because this is the
 * easiest way to keep them in UTC time.
 * This function simply gets the current data and time as a string.
 *
 * @return {string} - The current datetime as an ISO string.
 */
function getTimestamp() {
	return new Date(new Date().getTime()).toISOString();
}

// eslint-disable-next-line max-len
// ================================================================================================================================== Database
const pg  = require('pg');
const url = require('url');

let pgPool;

// Try to load the config file; it's fine if it doesn't load (e.g. on Heroku)
let config;
let configLoaded = true;

try {
	config = require('./config');
}
catch (e) {
	console.log('Config file couldn\'t be found; continuing without it...');
	configLoaded = false;
}

// Configure the database connection
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

// Create a necessary SQL function.
// TODO: Users may hit the "Save" button often to make their rating show up at
//       top of the list. This should be prevented
const query = `
	CREATE OR REPLACE FUNCTION upsert_ratings(
		uid integer,
		gid integer,
		new_rating real,
		new_time text )
	RETURNS VOID AS $$
		DECLARE
		BEGIN
			UPDATE ratings SET rating = new_rating, time_stamp = new_time
				WHERE user_id = uid AND game_id = gid;
			IF NOT FOUND THEN
			INSERT INTO ratings (user_id, game_id, rating, time_stamp)
				VALUES (uid, gid, new_rating, new_time);
			END IF;
		END;
		$$ LANGUAGE 'plpgsql';`;

pgPool.query(query, function(err, res) {
	if (err) {
		console.error(err);
	}
});

// eslint-disable-next-line max-len
// ================================================================================================================================== Sessions
const sessions = require('client-sessions');
const keygen   = require('generate-key');

const oneWeek = 1000 * 60 * 60 * 24 * 7; // In milliseconds

const sessionsConfig = sessions({
	cookieName: 'session',
	secret: keygen.generateKey(60),
	duration: oneWeek,
	activeDuration: oneWeek,
	httpOnly: true, // Prevents clients from using JavaScript to access cookies
	secure: true }); // Ensures that cookies are only sent over HTTPS

// res.session.user is the logged in user's username.
// res.locals contains the user's full details
const sessionsMiddleware = function(req, res, next) {
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
};

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
		// Remember where user was trying to go
		req.session.returnTo = req.originalUrl;

		res.redirect('/account/login');
	}
}

module.exports = {
	websiteName, // Globals
	getTimestamp, // General
	pgPool, // Database
	sessionsConfig, sessionsMiddleware, requireLogin }; // Sessions
