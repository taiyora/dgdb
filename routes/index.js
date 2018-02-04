const express = require('express');
const router = express.Router();

const websiteName = 'DGDB';

router.get('/', function(req, res, next) {
	res.render('index', {
		title: websiteName + ' // home' });
});

router.get('/game/new', function(req, res, next) {
	res.render('game/new', {
		title: websiteName + ' // new entry' });
});

module.exports = router;
