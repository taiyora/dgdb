const express = require('express');
const router = express.Router();

// Load necessary stuff from main.js
const main = require('../main');

const websiteName  = main.websiteName;
const getTimestamp = main.getTimestamp;
const pgPool       = main.pgPool;
router.use(main.sessionsConfig);
router.use(main.sessionsMiddleware);
const requireLogin = main.requireLogin;

// eslint-disable-next-line max-len
// ================================================================================================================================== List
router.use(function(req, res, next) {
	// The game list page needs to know what URL query was given
	res.locals.url = req.url;
	next();
});

router.get('/list', function(req, res, next) {
	let sortBy = 'rating_average';
	let orderBy = 'DESC';

	// Prevent SQL injection by checking against valid sorting options
	const validSortingOptions = [
		'title_english',
		'title_jp',
		'title_romaji',
		'rating_average',
		'ratings' ];

	// Determine the sorting and ordering methods
	if (req.query.s) { // s for sorting method
		if (validSortingOptions.indexOf(req.query.s.toLowerCase()) != -1) {
			sortBy = req.query.s;
		}

		if (req.query.o) { // o for ordering method
			if (req.query.o.toLowerCase() == 'asc' ||
				req.query.o.toLowerCase() == 'desc')
			{
				orderBy = req.query.o;
			}
		}
	}

	// If sorting by a text type, we need to convert NULL entries to empty strings
	// so that they go to the bottom of the list
	const stringSortingOptions = [
		'title_english',
		'title_jp',
		'title_romaji' ];

	if (stringSortingOptions.indexOf(sortBy) != -1) {
		sortBy = 'NULLIF(' + sortBy + ', \'\')';
	}

	// We use NULLS LAST so that when sorting by average rating for example,
	// all the entries with no ratings will come last
	const query = `
		SELECT
			*,

			(SELECT ROUND(AVG(ratings.rating)::numeric, 2)
				FROM ratings WHERE games.id = ratings.game_id)
					AS rating_average,

			(SELECT COUNT(ratings.rating) AS ratings
				FROM ratings WHERE games.id = ratings.game_id)
					AS ratings

		FROM games
		ORDER BY ` + sortBy + ' ' + orderBy + ' NULLS LAST;';

	pgPool.query(query, function(err, res2) {
		if (err) {
			console.error(err);

			res.render('game/list', {
				title: websiteName + ' // games',
				error: 'Something went wrong; please try again',
				getSortUrl: getSortUrl });
		}
		else {
			res.render('game/list', {
				title: websiteName + ' // games',
				games: res2.rows,
				getSortUrl: getSortUrl });
		}
	});
});

// eslint-disable-next-line max-len
// ------------------------------------------------------------------------------------------ List Functions
const queryString = require('query-string');

/**
 * Given a URL, checks the query string to see if an ordering is specified.
 * If so, it reverses it. This is so that a user can click a heading twice
 * to reverse the way it orders its values.
 * Also gives appropriate default orderings.
 *
 * @param {string} url - The current URL.
 * @param {string} column - The column heading that is requesting a URL.
 * @return {string} - The URL that the column heading should use.
 */
function getSortUrl(url, column) {
	const query = queryString.parseUrl(url).query;
	let ordering = 'asc';

	// Check if the query string already specifies an ordering
	if (query.o && query.s && query.s == column) {
		if (query.o.toLowerCase() == 'asc') {
			ordering = 'desc';
		}
	}
	else {
		/*
		* If we're trying to sort by a numeric type and haven't specified an
		* ordering yet, we should order by descending, so that e.g. the highest
		* ratings come first. Otherwise it's text and should be ascending.
		*/
		const numericSortingOptions = [
//			'rating_average', // Since the default sort is this DESC, exclude it
			'ratings' ];

		if (numericSortingOptions.indexOf(column) != -1) {
			ordering = 'desc';
		}
	}

	return '/game/list?s=' + column + '&o=' + ordering;
}

// eslint-disable-next-line max-len
// ================================================================================================================================== View
router.get('/view/:id', function(req, res, next) {
	// Get all the information on the game, as well as its related screenshots.
	// ss_urls:        A list of screenshots associated with the game.
	// ratings:        A list of every user's rating for the game.
	// rating_average: The average of every rating for the game.
	// ratings_recent: The 10 most recent ratings, with name of user who gave it.
	// user_rating:    The rating that the logged in user gave the game.
	const query = `
		SELECT
			*,

			array(SELECT url FROM screenshots WHERE game_id = $1)
				AS ss_urls,

			array(SELECT rating FROM ratings WHERE game_id = $1)
				AS ratings,

			(SELECT ROUND(AVG(rating)::numeric, 2) FROM ratings WHERE game_id = $1)
				AS rating_average,

			array_to_json(array(
				SELECT (users.username, ratings.rating, ratings.time_stamp) FROM ratings
				LEFT JOIN users ON users.id = ratings.user_id
				WHERE game_id = $1
				ORDER BY time_stamp DESC LIMIT 10))
					AS ratings_recent,

			(SELECT rating FROM ratings WHERE game_id = $1 AND user_id = $2)
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
				page: 'view', // Required for correct formatting
				error: 'Something went wrong; please try again',
				game: {} });
		}
		else if (!res2.rows.length) {
			res.render('game/view', {
				title: websiteName + ' // game',
				page: 'view', // Required for correct formatting
				error: 'No entry with that ID exists',
				game: {} });
		}
		else {
			windowTitle =
				res2.rows[0].title_romaji.length ?
					res2.rows[0].title_romaji :
					res2.rows[0].title_jp ?
						res2.rows[0].title_jp :
						res2.rows[0].title_english;

			res.render('game/view', {
				title: websiteName + ' // ' + windowTitle,
				page: 'view', // Required for correct formatting
				game: res2.rows[0] });
		}
	});
});

// eslint-disable-next-line max-len
// ------------------------------------------------------------------------------------------ Update Rating
router.post('/updateRating', requireLogin, function(req, res, next) {
	const form = req.body;

	// Make sure that the given rating has only one decimal place
	let rating = Math.round(form.user_rating * 10) / 10;

	// Ensure that rating is within bounds
	if (rating < 1 || rating > 10) {
		res.send('failure');
		return;
	}

	const query = `SELECT upsert_ratings($1, $2, $3, $4);`;
	const vars = [
		res.locals.user ? res.locals.user.id : 0,
		form.game_id,
		rating,
		getTimestamp() ];

	pgPool.query(query, vars, function(err, res2) {
		if (err) {
			console.error(err);
		}
		else {
			res.send('success');
		}
	});
});

// eslint-disable-next-line max-len
// ================================================================================================================================== New/Edit
/*
 * Both adding a new entry and editing an existing entry are handled by the
 * same router function and page. When editing, the "new entry" page will be
 * given a flag and the game ID. This specifies the fact that we're editing.
 *
 * To preserve sensible window titles and URLs, the form will still post to
 * edit/:id when editing, but functionally it'll be handled mostly the same
 * way as a new entry being saved.
 */
router.get('/new', requireLogin, function(req, res, next) {
	res.render('game/new', {
		title: websiteName + ' // new entry',
		form: {},
		formAction: '/game/new',
		editing: false });
});

router.post(['/new', '/edit/:id'], requireLogin, function(req, res, next) { // eslint-disable-line max-len
	const form = req.body;
	let error = '';

	let destPageTitle = websiteName + ' // new entry';
	let formAction = '/game/new';
	let editing = false;

	let gameId = 0;

	if (req.params.id) {
		// In this case, we're actually editing an existing entry.
		// By gameId being not 0, everything here will be handled in the context of
		// editing rather than adding a new entry
		gameId = req.params.id;

		windowTitle =
		form.title_romaji.length ?
			form.title_romaji :
			form.title_jp ?
				form.title_jp :
				form.title_english;

		destPageTitle = websiteName + ' // edit: ' + windowTitle;
		formAction = '/game/edit/' + req.params.id;
		editing = true;
	}

	// Ensure that the user hasn't bypassed the character limits
	if (form.title_jp.length      > 100  ||
		form.title_romaji.length  > 100  ||
		form.title_english.length > 100  ||
		form.title_other.length   > 100  ||
		form.website.length       > 100  ||
		form.vndb.length          > 25   ||
		form.download.length      > 200  ||
		form.download_alt.length  > 200  ||
		form.description.length   > 3100 || // textarea maxlength is wrong?
		form.screenshots.length   > 1100)   // ^
	{
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
			saveGameEntry(form, gameId, function(success, retGameId) {
				if (success) {
					if (screenshotsValidated.length) {
						saveScreenshots(screenshotsValidated, retGameId);
					}

					res.redirect('/game/view/' + retGameId);
				}
				else {
					res.render('game/new', {
						title: destPageTitle,
						error: 'Something went wrong; please try again',
						form: form,
						formAction: formAction,
						editing: editing });
				}
			});
		}
	}

	if (error) {
		res.render('game/new', {
			title: destPageTitle,
			error: error,
			form: form,
			formAction: formAction,
			editing: editing });
	}
});

// eslint-disable-next-line max-len
// ------------------------------------------------------------------------------------------ Functions
/**
 * Saves a game entry to the database.
 *
 * @param {dict} form - Information about the game (from a form).
 * @param {bool} gameId - The game ID if we're editing, or 0 if a new entry.
 * @param {function(bool, int)} callback - The callback function.
 */
function saveGameEntry(form, gameId, callback) {
	let query;
	let vars;

	if (gameId) {
		// Edit an existing entry
		query = `
			UPDATE games SET
				title_jp = $2,
				title_romaji = $3,
				title_english = $4,
				title_english_official = $5,
				title_other = $6,
				description = $7,
				website = $8,
				vndb = $9,
				download = $10,
				download_alt = $11,
				last_updated = $12
			WHERE id = $1
			RETURNING id;`;

		vars = [
			gameId,
			form.title_jp,
			form.title_romaji,
			form.title_english,
			form.title_english_official ? 'TRUE' : 'FALSE',
			form.title_other,
			form.description,
			form.website,
			form.vndb,
			form.download,
			form.download_alt,
			getTimestamp() ];
	}
	else {
		// Create a new entry
		query = `
			INSERT INTO games (
				title_jp,
				title_romaji,
				title_english,
				title_english_official,
				title_other,
				description,
				website,
				vndb,
				download,
				download_alt,
				entry_created )
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
			RETURNING id;`;

		vars = [
			form.title_jp,
			form.title_romaji,
			form.title_english,
			form.title_english_official ? 'TRUE' : 'FALSE',
			form.title_other,
			form.description,
			form.website,
			form.vndb,
			form.download,
			form.download_alt,
			getTimestamp() ];
	}

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
 * Screenshots should have a unique constraint in the database, so duplicates
 * won't be stored, meaning don't have to worry about that here.
 *
 * @param {array} screenshots - An array of screenshot URLs.
 * @param {int} gameId - The ID of the game the screenshot is related to.
 */
function saveScreenshots(screenshots, gameId) {
	// Form the query string
	let query = 'INSERT INTO screenshots (url, game_id, time_stamp) VALUES';
	let vars = [
		gameId,
		getTimestamp() ];

	let n = 2;
	screenshots.forEach(function(ss) {
		n++;
		if (n > 3) {
			query += ',';
		}

		query += ' ($' + n + ', $1, $2)';
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

// eslint-disable-next-line max-len
// ================================================================================================================================== Edit
/*
 * Editing is actually handled the same way as making a new entry. But as long
 * as the formAction variable is set correctly, we'll edit the entry instead.
 */
router.get('/edit/:id', requireLogin, function(req, res, next) {
	const query = 'SELECT * FROM games WHERE id = $1;';
	const vars = [ req.params.id ];

	pgPool.query(query, vars, function(err, res2) {
		if (err) {
			console.error(err);

			res.render('game/new', {
				title: websiteName + ' // edit',
				error: 'Something went wrong; please try again' });
		}
		else if (!res2.rows.length) {
			res.render('game/new', {
				title: websiteName + ' // edit',
				error: 'No entry with that ID exists' });
		}
		else {
			windowTitle =
				res2.rows[0].title_romaji.length ?
					res2.rows[0].title_romaji :
					res2.rows[0].title_jp ?
						res2.rows[0].title_jp :
						res2.rows[0].title_english;

			res.render('game/new', {
				title: websiteName + ' // edit: ' + windowTitle,
				form: res2.rows[0],
				formAction: '/game/edit/' + req.params.id,
				editing: true });
		}
	});
});

module.exports = router;
