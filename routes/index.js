const express = require('express');
const router = express.Router();

router.use('/account', require('./account'));
router.use('/game',    require('./game'));
router.use('/release', require('./release'));

// Load necessary stuff from main.js
const main = require('../main');

const websiteName = main.websiteName;
router.use(main.sessionsConfig);
router.use(main.sessionsMiddleware);

// eslint-disable-next-line max-len
// ======================================================================================================================== Home
router.get('/', function(req, res, next) {
	res.render('index', {
		title: websiteName + ' // home' });
});

module.exports = router;
