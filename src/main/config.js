// Carga config/launcher.config.js (editable por el usuario).
const paths = require('./paths');
module.exports = require(paths.inRoot('config', 'launcher.config.js'));
