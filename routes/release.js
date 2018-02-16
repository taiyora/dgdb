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

module.exports = router
