var tty = require('tty'),
	path = require('path'),
	http = require('http'),
	request = require('request'),
	vm = require('vm'),
	fs = require('fs');

var utils = require('./utils.js'),
	createQueenRemoteServer = require("./server/server.js");

var runner = module.exports = function(queenFactory, config, callback){
	if(!config) throw new Error('Config must be defined');
	callback = callback || utils.noop;

	tryToLoadConfigModule(config);

	// This fills any default properties to the config object (if they're not defined)
	var defaults = require('../config/runner.json');
	setDefaults(config, defaults);

	// Collapse the config options and default options in to one variable
	var log = config.log = config.quiet? utils.noop : process.stdout.write.bind(process.stdout),
		debug = config.debug = config.verbose? process.stdout.write.bind(process.stdout) : utils.noop;


	if(config.remote !== void 0){
		queenFactory = require('./client/queen.js');
	}

	log("[Queen] Starting...\n");
	debug("[Queen] Verbose logging enabled\n");

	queenFactory({
		callback: function(queen){
			configureQueenServer(queen, config, callback);
		},
		host: config.remote,
		captureHost: config.capture,
		heartbeatInterval: config.heartbeatInterval,
		log: log,
		debug: debug
	});
};

// This tried to load a config module defiend in config.module and merge it to the given
// object
function tryToLoadConfigModule(config){
	// A queen.js file may pass in a default "base" queen.js file to use for default values
	// This only goes one level down, if the defaults file defines a defaults file, it won't be
	// evaluated.
	if(config.config) config.module = config.config;

	var configModule;
	if(config.module){
		try { 
			configModule = require(config.module);
		} catch(e){
			console.error("[Queen] Unable to load config module: " + config.module);
			throw e;
		}
	} else {
		// Try to see if there is a queenConfig.js file
		try{
			configModule = require(path.resolve(process.cwd(), "queenConfig.js"));
		} catch(e){
			// It's ok if this errors, because it's optional
		}
	}

	if(configModule){
		if(typeof configModule === "function"){
			config.script = configModule;
		} else if(typeof configModule === "object"){
			setDefaults(config, configModule);
		}
	}
}

function configureQueenServer(queen, config, callback){
	var log = config.log,
		debug = config.debug;

	if(queen instanceof Error){
		log("[Queen] Instantiation error: " + queen + "\n");
		return callback(queen);
	}

	process.on('exit', queen.kill); // Won't work on Windows

	if(config.plugin){
		utils.each(config.plugin, function(factory, name){
			log("[Queen] Initializing plugin: " + name + "\n");
			factory(queen, config, {
				log: log,
				debug: debug
			});
		});
	}
	
	if(config.script){
		if(typeof config.script === "string"){
			if(config.script.indexOf("://")){
				log("[Queen] Loading remote script: " + config.script + "\n");

				request(config.script, function(error, response, body){
					if(error || response.statusCode !== 200){
						if(!error) error = new Error(response.statusCode);
						callback(error);
						return;
					}

					var sandbox = {
						queen: queen
					};

					try{
						log("[Queen] Executing remote script: " + config.script + "\n");
						contents = "(function(){var module = {exports: {}};\n" + body + "\n;module.exports(queen)}());";
						vm.runInNewContext(contents, sandbox);	
						callback(queen);
					} catch(e){
						log("[Queen] Error occurred when executing remote script: " + config.script + " (" + e + ")\n");
						callback(e);
					}
				});
			} else {
				try{
					log("[Queen] Loading script module: " + config.script + "\n");
					config.script = require(config.script);
					config.script(queen);
					callback(queen);
				} catch(e){
					log("[Queen] Error occurred when loading script module: " + config.script + " (" + e + ")\n");
					callback(e);
				}
			}
		} else {
			try{
				config.script(queen);
			} catch(e){
				log("[Queen] Error occurred when executing script: " + e + "\n");
				return callback(e);
			}
			callback(queen);
		}
	} else {
		createQueenRemoteServer(queen, {
			callback: function(error){ // "error" is a server instance if there is no error.
				if(error instanceof Error){
					callback(error);
				} else {
					callback(queen);
				}
			},
			host: config.host,
			log: log,
			debug: debug
		});

		return;
	}
}

// Fills in obj with defaults' variables if obj doesn't already define it.
function setDefaults(obj, defaults){
	var variable;
	utils.each(defaults, function(value, key){
		if(obj[key] === void 0) obj[key] = value;
	});
	
	return obj;
}
