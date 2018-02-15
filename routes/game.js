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
// ======================================================================================================================== List
router.use(function(req, res, next) {
	// The game list page needs to know what URL query was given
	res.locals.url = req.url;
	next();
});

router.get('/list', function(req, res, next) {
	let sortBy = 'rating_bayesian';
	let orderBy = 'DESC';

	// Prevent SQL injection by checking against valid sorting options
	const validSortingOptions = [
		'title_english',
		'title_jp',
		'title_romaji',
		'rating_bayesian',
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

			(SELECT get_bayesian_rating(
				COUNT(ratings.rating)::integer,
				AVG(ratings.rating)::real,
				1::integer,
				5.5::real )
					FROM ratings WHERE games.id = ratings.game_id)
						AS rating_bayesian,

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
			'rating_bayesian',
			'ratings' ];

		if (numericSortingOptions.indexOf(column) != -1) {
			ordering = 'desc';
		}
	}

	return '/game/list?s=' + column + '&o=' + ordering;
}

// eslint-disable-next-line max-len
// ======================================================================================================================== View
router.get('/view/:id', function(req, res, next) {
	// Get all the information on the game, as well as its related screenshots.
	// ss_urls:        A list of (enabled) screenshots associated with the game.
	// ratings:        A list of every user's rating for the game.
	// rating_average: The average of every rating for the game.
	// ratings_recent: The 10 most recent ratings, with name of user who gave it.
	// user_rating:    The rating that the logged in user gave the game.
	const query = `
		SELECT
			*,

			array(SELECT url FROM screenshots WHERE game_id = $1 AND enabled = TRUE)
				AS ss_urls,

			array(SELECT rating FROM ratings WHERE game_id = $1)
				AS ratings,

			(SELECT get_bayesian_rating(
				COUNT(ratings.rating)::integer,
				AVG(ratings.rating)::real,
				1::integer,
				5.5::real )
					FROM ratings WHERE games.id = ratings.game_id)
						AS rating_bayesian,

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
// ======================================================================================================================== Revisions
router.get('/revisions/:id/', function(req, res, next) {
	const query = `
		SELECT
			*,
			(SELECT username FROM users WHERE id = user_id)
				AS username
		FROM revisions WHERE game_id = $1 ORDER BY id DESC;`;

	const vars = [ req.params.id ];

	pgPool.query(query, vars, function(err, res2) {
		if (err) {
			console.error(err);

			res.render('game/revisions', {
				title: websiteName + ' // revisions',
				error: 'Something went wrong; please try again',
				revisions: {} });
		}
		else if (!res2.rows.length) {
			res.render('game/revisions', {
				title: websiteName + ' // revisions',
				error: 'No revisions were found',
				revisions: {} });
		}
		else {
			res.render('game/revisions', {
				title: websiteName + ' // revisions',
				revisions: res2.rows });
		}
	});
});

// eslint-disable-next-line max-len
// ======================================================================================================================== New | Edit (POST)
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

		// Make sure the user entered a revision message
		if (!form.message) {
			error = 'Please enter a revision message noting what change(s) you made';
		}
		else {
			if (form.message.length > 310) { // textarea maxlength is wrong?
				error = 'Bypassing the character limit is bad!';
			}
		}
	}
	else {
		// Since this must be a new entry, set form.message to be a relevant note
		form.message = '(auto) New entry';
	}

	if (error) {
		; // Skip to the end of the function if there was an error
	}

	// Ensure that the user hasn't bypassed the character limits
	else if (form.title_jp.length > 100  ||
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
			saveGameEntry(form, gameId, res.locals.user.id, function(success, retGameId) { // eslint-disable-line max-len
				if (success) {
					// Even if no screenshots were entered, we need to do this in case
					// existing screenshots were removed and need to be disabled
					saveScreenshots(screenshotsValidated, retGameId);

					res.redirect('/game/view/' + retGameId);
				}
				else {
					res.render('game/new', {
						title: destPageTitle,
						error: `Something went wrong; please try again.
							Did you not make any changes?`,
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
 * @param {int} gameId - The game ID if we're editing, or 0 if a new entry.
 * @param {int} userId - The ID of the user making the edit.
 * @param {function(bool, int)} callback - The callback function.
 */
function saveGameEntry(form, gameId, userId, callback) {
	let query;
	let vars = [
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
		form.screenshots,
		getTimestamp() ];

	if (gameId) {
		// We're editing an existing entry.
		// This query will return the values from before the edit, so that we can
		// enter the changes into the revision details
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
				screenshots = $12
			FROM (SELECT * FROM games WHERE id = $1 FOR UPDATE) dummy
			WHERE games.id = dummy.id
			RETURNING dummy.*;`;

		// Add the game ID and remove the timestamp (which is the last element)
		vars = [gameId].concat(vars);
		vars.pop();
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
				screenshots,
				entry_created )
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
			RETURNING *;`;
	}

	pgPool.query(query, vars, function(err, res) {
		if (err) {
			console.error(err);
			callback(false, 0);
		}
		else {
			// Add the changes as a new revision to the database
			query = 'INSERT INTO revisions (game_id, user_id, time_stamp, message';
			vars = [
				gameId ? gameId : res.rows[0].id,
				userId,
				getTimestamp(),
				form.message ];

			delete form.message;

			// The HTML form identifies a checked checkbox with the string "on".
			// This needs to be changed to "true", so that it matches PostgreSQL.
			// It's also "undefined" when unchecked, so that needs to be "false"
			if (form.title_english_official) {
				form.title_english_official = true;
			}
			else {
				form.title_english_official = false;
			}

			// Determine which fields were edited
			// (or just add whatever fields were filled if it's a new entry)
			for (const key in form) {
				if ((form[key] != res.rows[0][key]) || (!gameId && form[key])) {
					query += ', ' + key;
					vars.push(form[key]);
					console.log(form[key], res.rows[0][key]);
				}
			}

			query += ') VALUES ($1, $2, $3, $4';

			for (let i = 5; i <= vars.length; i++) {
				query += ', ' + '$' + i;
			}

			query += ');';

			// Only add the revision if anything was actually changed.
			// If 'vars' is only length 4, then nothing was changed
			if (vars.length > 4) {
				pgPool.query(query, vars, function(err, res2) {
					if (err) {
						console.error(err);
					}
				});

				// Change the Last Updated value for the game entry
				query = 'UPDATE games SET last_updated = $1 WHERE id = $2;';
				vars = [
					getTimestamp(),
					gameId ];

				pgPool.query(query, vars, function(err, res2) {
					if (err) {
						console.error(err);
					}
					else {
						// Wait until now to do the callback, so that the game view page
						// shows the correct Last Updated time
						callback(true, res.rows[0].id);
					}
				});
			}
			else {
				callback(false, res.rows[0].id);
			}
		}
	});
}

/**
 * Saves a list of screenshots to the database.
 * First, every screenshot associated with the specified game ID is disabled.
 * Then any new screenshots are inserted. If there's a URL conflict, that
 * screenshot gets re-enabled (because it has remained in the list).
 * Removed screenshots remain in the database, just disabled, just in case.
 *
 * Game entries also store a list of screenshots as a string.
 * This is just so that screenshot changes can be saved in the revision system.
 *
 * @param {array} screenshots - An array of screenshot URLs.
 * @param {int} gameId - The ID of the game the screenshot is related to.
 */
async function saveScreenshots(screenshots, gameId) {
	// First disable all related screenshots
	let query = 'UPDATE screenshots SET enabled = FALSE WHERE game_id = $1;';
	let vars = [ gameId ];

	await pgPool.query(query, vars);

	// Only try to save/re-enable screenshots if any were actually entered
	if (screenshots.length) {
		// Now save the new screenshots and re-enable the ones still in the list
		query = `
			INSERT INTO screenshots (
				url,
				game_id,
				time_stamp,
				enabled )
			VALUES`;

		vars = [
			gameId,
			getTimestamp() ];

		let n = 2;
		screenshots.forEach(function(ss) {
			n++;
			if (n > 3) {
				query += ',';
			}

			query += ' ($' + n + ', $1, $2, TRUE)';
			vars.push(ss);
		});

		query += ' ON CONFLICT (url) DO UPDATE SET enabled = TRUE;';

		pgPool.query(query, vars, function(err, res2) {
			if (err) {
				console.error(err);
			}
		});
	}
}

// eslint-disable-next-line max-len
// ======================================================================================================================== Edit (GET)
/*
 * Editing is actually handled the same way as making a new entry. But as long
 * as the formAction variable is set correctly, we'll edit the entry instead.
 */
router.get('/edit/:id', requireLogin, function(req, res, next) {
	// When editing, we get a list of enabled screenshots associated with the
	// game. When saving changes, any changes to the list will be reflected
	// in the database via enabling or disabling screenshot entries.
	const query = `
		SELECT
			*,
			array_to_string(array(SELECT url FROM screenshots
				WHERE game_id = $1 AND enabled = TRUE), ',')
					AS screenshots
		FROM games WHERE id = $1;`;

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

			// Format the screenshots list to display correctly in the form textarea
			res2.rows[0].screenshots = res2.rows[0].screenshots.split(',').join('\n');

			res.render('game/new', {
				title: websiteName + ' // edit: ' + windowTitle,
				form: res2.rows[0],
				formAction: '/game/edit/' + req.params.id,
				editing: true });
		}
	});
});

module.exports = router;
