const express = require('express');
const router = express.Router();

// Load necessary stuff from main.js
const main = require('../main');

const websiteName  = main.websiteName;
const getTimestamp = main.getTimestamp;
const pgPool       = main.pgPool;
router.use(main.sessionsConfig);
router.use(main.sessionsMiddleware);

// eslint-disable-next-line max-len
// ======================================================================================================================== Login
router.get('/login', function(req, res, next) {
	if (req.session.user) {
		res.redirect('/');
	}
	else {
		res.render('account/login', {
			title: websiteName + ' // login',
			form: {} });
	}
});

router.post('/login', function(req, res, next) {
	const form = req.body;
	let error = '';

	if (!form.username || !form.password) {
		error = 'A required field was left blank';
	}
	else if (form.username.length > 20 || form.password.length > 100) {
		error = 'Bypassing the character limit is bad!';
	}
	else {
		const query = 'SELECT * FROM users WHERE username = $1;';
		const vars = [ form.username ];

		pgPool.query(query, vars, function(err, res2) {
			if (err) {
				console.error(err);
				error = 'Something went wrong; please try again';
			}
			else if (res2.rows.length <= 0) {
				error = 'No user with that username exists';
			}
			else {
				if (bcrypt.compareSync(form.password, res2.rows[0].pw_hash)) {
					req.session.user = form.username;
					res.redirect(req.session.returnTo ? req.session.returnTo : '/');
				}
				else {
					error = 'Invalid credentials';
				}
			}

			if (error) {
				res.render('account/login', {
					title: websiteName + ' // login',
					error: error,
					form: form });
			}
		});
	}

	if (error) {
		res.render('account/login', {
			title: websiteName + ' // login',
			error: error,
			form: form });
	}
});

// eslint-disable-next-line max-len
// ======================================================================================================================== Logout
router.get('/logout', function(req, res, next) {
	req.session.reset();
	res.redirect('/');
});

// eslint-disable-next-line max-len
// ======================================================================================================================== Register
router.get('/register', function(req, res, next) {
	if (req.session.user) {
		res.redirect('/');
	}
	else {
		res.render('account/register', {
			title: websiteName + ' // register',
			form: {} });
	}
});

router.post('/register', function(req, res, next) {
	const form  = req.body;
	let error = '';

	if (!form.username || !form.password) {
		error = 'A required field was left blank';
	}
	else if (form.username.length < 3 || form.username.length > 20) {
		error = 'Username must be between 3 and 20 characters long (inclusive)';
	}
	else if (!isPlainText(form.username)) {
		error = 'Username must use only plain text characters (a-z, A-Z, 0-9)';
	}
	else if (form.password.length < 10 || form.password.length > 100) {
		error = 'Password must be between 10 and 100 characters long (inclusive)';
	}
	else if (!isAscii(form.password)) {
		error = 'Password must use only ASCII characters';
	}
	else {
		doesUsernameExist(form.username, function(exists) {
			if (exists) {
				res.render('account/register', {
					title: websiteName + ' // register',
					error: 'Username is taken',
					form: form });
			}
			else {
				registerUser(form, res);
			}
		});
	}

	if (error) {
		res.render('account/register', {
			title: websiteName + ' // register',
			error: error,
			form: form });
	}
});

// eslint-disable-next-line max-len
// ------------------------------------------------------------------------------------------ Register Functions
const bcrypt = require('bcrypt'); // For hashing the password

/**
 * Ensures that an string contains only plaintext.
 * Used to validate usernames.
 *
 * @param {string} text - The text.
 * @return {bool} - true if the text is plaintext, false otherwise.
 */
function isPlainText(text) {
	const regex = /^[a-zA-Z0-9]*$/;
	return regex.test(text);
}

/**
 * Ensures that an string contains only ASCII.
 * Used to validate passwords.
 *
 * @param {string} text - The text.
 * @return {bool} - true if the text is entirely ASCII, false otherwise.
 */
function isAscii(text) {
	const regex = /^[\x20-\x7e]*$/;
	return regex.test(text);
}

/**
 * Checks whether the specified username already exists in the database.
 *
 * @param {string} username - The username.
 * @param {function(bool)} callback - The callback function.
 */
function doesUsernameExist(username, callback) {
	const query = 'SELECT * FROM users WHERE username = $1;';
	const vars = [ username ];

	pgPool.query(query, vars, function(err, res) {
		if (err) {
			console.error(err);
			callback(true);
		}
		else {
			callback(res.rows.length > 0);
		}
	});
}

/**
 * Registers a new user in the database.
 *
 * @param {dict} user - The user's details.
 * @param {dict} res - So that .render can be accessed.
 */
function registerUser(user, res) {
	// Hash the password before saving it to the database
	const salt = bcrypt.genSaltSync(10);
	const hash = bcrypt.hashSync(user.password, salt);

	const query = `
		INSERT INTO users (
			username,
			pw_hash,
			created)
		VALUES ($1, $2, $3);`;

	const vars = [
		user.username,
		hash,
		getTimestamp() ];

	pgPool.query(query, vars, function(err, res2) {
		if (err) {
			console.error(err);

			res.render('account/register', {
				title: websiteName + ' // register',
				error: 'Something went wrong; please try again',
				form: user });
		}
		else {
			res.render('account/login', {
				title: websiteName + ' // login',
				message: 'Account created! You may now login',
				form: user });
		}
	});
}

module.exports = router;
