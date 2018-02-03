const express = require('express');
const router = express.Router();

const websiteName = 'DGDB';

router.get('/', function(req, res, next) {
	res.render('index', {
		title: websiteName + ' // home' });
});

module.exports = router;
