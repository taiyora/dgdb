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

	const languages = [
		'Japanese',
		'English',
		'French' ];

	const releaseDateRegex = /[1-2][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]/g;

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
		const query = `
			INSERT INTO releases (
				game_id,
				title,
				language,
				release_date,
				version,
				entry_created )
			VALUES ($1, $2, $3, $4, $5, $6);`;

		const vars = [
			form.game_id,
			form.title,
			form.language,
			form.release_date,
			form.version,
			getTimestamp() ];

		pgPool.query(query, vars, function(err, res2) {
			if (err) {
				console.error(err);

				res.render('release/new', {
					title: websiteName + ' // new release',
					error: 'Something went wrong; please try again',
					form: form,
					formAction: '/release/new',
					editing: false,
					gameId: form.game_id });
			}
			else {
				res.redirect('/game/view/' + form.game_id);
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

module.exports = router;
