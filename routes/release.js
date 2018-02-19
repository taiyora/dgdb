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
// ======================================================================================================================== New
router.get('/new/:gameId', requireLogin, function(req, res, next) {
	res.render('release/new', {
		title: websiteName + ' // new release',
		form: {},
		formAction: '/release/new',
		editing: false,
		gameId: req.params.gameId });
});

router.post('/new', requireLogin, function(req, res, next) {
	const form = req.body;
	let error = '';

	let destPageTitle = websiteName + ' // new release';
	let formAction = '/release/new';
	let editing = false;

	let releaseId = 0;
	form.message = '(auto) New release';

	const languages = [
		'Japanese',
		'English',
		'French' ];

	const releaseDateRegex = /([1-2]|x)([0-9]|x)([0-9]|x)([0-9]|x)-([0-1]|x)([0-9]|x)-([0-3]|x)([0-9]|x)/g; // eslint-disable-line max-len

	// Ensure that the user hasn't bypassed the character limits
	if (form.title.length         > 100 ||
		form.language.length      > 10  ||
		form.release_date.length  > 10  ||
		form.version.length       > 50)
	{
		error = 'Bypassing the character limit is bad!';
	}

	// Ensure that the required fields have been populated (and properly)
	else if (!form.title) {
		error = 'A title is required';
	}
	else if (languages.indexOf(form.language) == -1) {
		error = 'Please use one of the listed languages';
	}
	else if (!form.release_date.match(releaseDateRegex)) {
		error = 'Release date is invalid';
	}

	else {
		saveReleaseEntry(form, releaseId, res.locals.user.id, function(success) { // eslint-disable-line max-len
			if (success) {
				res.redirect('/game/view/' + form.game_id);
			}
			else {
				res.render('release/new', {
					title: destPageTitle,
					error: `Something went wrong; please try again.
						Did you not make any changes?`,
					form: form,
					formAction: formAction,
					editing: editing,
					gameId: req.params.gameId });
			}
		});
	}

	if (error) {
		res.render('release/new', {
			title: websiteName + ' // new release',
			error: error,
			form: form,
			formAction: '/release/new',
			editing: false,
			gameId: form.game_id });
	}
});

// eslint-disable-next-line max-len
// ------------------------------------------------------------------------------------------ Functions
/**
 * Saves a release entry to the database.
 *
 * @param {dict} form - Information about the release (from a form).
 * @param {int} releaseId - The release ID if we're editing, or 0 if new.
 * @param {int} userId - The ID of the user making the edit.
 * @param {function(bool, int)} callback - The callback function.
 */
function saveReleaseEntry(form, releaseId, userId, callback) {
	let query;
	let vars = [
		form.game_id,
		form.title,
		form.language,
		form.release_date,
		form.version,
		getTimestamp() ];

	if (releaseId) {
		// We're editing an existing entry.
		// This query will return the values from before the edit, so that we can
		// enter the changes into the revision details
		query = `
			UPDATE releases SET
				game_id = $2,
				title = $3,
				language = $4,
				release_date = $5,
				version = $6,
			FROM (SELECT * FROM releases WHERE id = $1 FOR UPDATE) dummy
			WHERE releases.id = dummy.id
			RETURNING dummy.*;`;

		// Add the release ID and remove the timestamp (which is the last element)
		vars = [releaseId].concat(vars);
		vars.pop();
	}
	else {
		// Create a new entry
		query = `
			INSERT INTO releases (
				game_id,
				title,
				language,
				release_date,
				version,
				entry_created )
			VALUES ($1, $2, $3, $4, $5, $6)
			RETURNING *;`;
	}

	pgPool.query(query, vars, function(err, res) {
		if (err) {
			console.error(err);
			callback(false);
		}
		else {
			// Add the changes as a new revision to the database
			query = `INSERT INTO revisions_rls
				(release_id, user_id, time_stamp, message`;

			vars = [
				releaseId ? releaseId : res.rows[0].id,
				userId,
				getTimestamp(),
				form.message ];

			delete form.message;

			// Determine which fields were edited
			// (or just add whatever fields were filled if it's a new entry)
			for (const key in form) {
				if ((form[key] != res.rows[0][key]) || (!releaseId && form[key])) {
					query += ', ' + key;
					vars.push(form[key]);
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

				// Change the Last Updated value for the release entry
				query = 'UPDATE releases SET last_updated = $1 WHERE id = $2;';
				vars = [
					getTimestamp(),
					releaseId ? releaseId : res.rows[0].id ];

				pgPool.query(query, vars, function(err, res2) {
					if (err) {
						console.error(err);
					}
				});

				callback(true);
			}
			else {
				callback(false);
			}
		}
	});
}

module.exports = router;
