const express = require('express');
const router = express.Router();

router.use('/account', require('./account'));
router.use('/game',    require('./game'));
router.use('/release', require('./release'));

// Load necessary stuff from main.js
const main = require('../main');

const websiteName = main.websiteName;
const pgPool      = main.pgPool;
router.use(main.sessionsConfig);
router.use(main.sessionsMiddleware);

// eslint-disable-next-line max-len
// ======================================================================================================================== Home
router.get('/', function(req, res, next) {
	res.render('index', {
		title: websiteName + ' // home' });
});

// eslint-disable-next-line max-len
// ======================================================================================================================== Revisions
router.get('/revisions', function(req, res, next) {
	const query = `
		SELECT
			time_stamp,
			'g' AS type,
			id,
			game_id AS relation_id,
			message,

			(SELECT coalesce(
				NULLIF(title_romaji, ''),
				NULLIF(title_english, ''),
				NULLIF(title_jp, '')
			)
			FROM games WHERE id = game_id)
				AS title,

			(SELECT username FROM users WHERE id = user_id)
				AS username

		FROM revisions
		
		UNION ALL

		SELECT
			time_stamp,
			'r' AS type,
			id,
			release_id AS relation_id,
			message,

			(SELECT title FROM releases WHERE id = release_id)
				AS name,

			(SELECT username FROM users WHERE id = user_id)
				AS username

		FROM revisions_rls

		ORDER BY time_stamp DESC;`;

	pgPool.query(query, function(err, res2) {
		if (err) {
			console.error(err);

			res.render('revisions', {
				title: websiteName + ' // revisions',
				error: 'Something went wrong; please try again',
				revisions: {} });
		}
		else if (!res2.rows.length) {
			res.render('revisions', {
				title: websiteName + ' // revisions',
				error: 'No revisions were found',
				revisions: {} });
		}
		else {
			res.render('revisions', {
				title: websiteName + ' // revisions',
				revisions: res2.rows });
		}
	});
});

module.exports = router;
