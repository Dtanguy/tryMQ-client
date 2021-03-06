
function core() {
	
	//var os = require('os');
	var Buffer = require('buffer').Buffer;
	var dgram = require('dgram');
	var crypto = require('crypto');
	var WebSocketServer = require('ws').Server;
	var shared = require('./shared');
	
	var param = {};
	var server = {};	
	var errorCb;

	//Initialize a broker	
	this.setup = function(id_, param_, errorCb_) {
		errorCb = errorCb_;
		param = param_
		shared.init(id_, upError, send);	
		shared.setCo(true);		
		
		console['log']("Started " + shared.id());
		loop();

		//Init all the server found in the config
		if(param.portUDP && param.brokerIpUDP){
			for(i = 0; i < param.brokerIpUDP.length; i++){
				this.initUDP(param.portUDP, param.brokerIpUDP[i]);
			}
		}
		if(param.portWS &&  param.brokerIpWS){
			this.initWS(param.portWS, param.brokerIpWS);
		}
	};
	
	
	//Specifique send instruction
	function send(data, txt){
		Queue[data.topic] = {d: data, m: txt};
	};
	
	//Push to the upper level the error
	function upError(err, code){
		if (!err) {
			errorCb('Error, no error.. -_-"', 0);
			return;
		}
		if(errorCb){
			errorCb(err, code);
		}else{
			if(code == 0){
				shared.warn(err);
			}else{
				shared.error(err);
			}
		}
	};
	


	/*************************************************** UDP **********************************************/
	this.initUDP = function(port, brokerIp) {
		
		var id = crypto.randomBytes(8).toString('hex');
		server[id] = dgram.createSocket('udp4');

		server[id].on('listening', function () {
			var address = server[id].address();
			console['log']('TryMQ UDP broker listening on ' + address.address + ":" + address.port);
		});

		server[id].on('message', function (message, remote) {			
			var meta = {
				id: 		id,
				type: 		"udp",
				address: 	remote.address,
				ip: 		remote.address,
				port: 		remote.port
			};			
			newMessage(message, meta);	
		});

		server[id].on('error', function (err) {
			upError(err, 1);
		});

		server[id].on('close', function () {
			console['log']('CLOSE UDP');
		});

		server[id].bind(port, brokerIp);	
		
	};


	/*************************************************** WS **********************************************/
	this.initWS = function(portWS, brokerIp) {		
		
		var wss = new WebSocketServer({port: portWS});	
		
		wss.on('listening', function(ws) {
			console['log']('TryMQ WS broker listening on ' + brokerIp + ":" + portWS);
		});

		wss.on('connection', function(ws, req) {
			console['log']('TryMQ WS new connection ' + req.connection.remoteAddress + ":" + portWS);
			var id = crypto.randomBytes(8).toString('hex');
			server[id] = ws;
			
			server[id].on('message', function(message) {
				var meta = {
					id: 		id,
					type: 		"ws",
					address: 	req.connection.remoteAddress.replace('::ffff:',''),
					ip: 		req.connection.remoteAddress.replace('::ffff:',''),
					port: 		portWS
				};			
				newMessage(message, meta);		
			});	
			
			server[id].on('error', function (err) {
				upError(err, 1);
			});
				
			server[id].on('close', function () {
				console['log']('CLOSE WS');
			});	
		
		});
	
	};
	
	
	
	
	
	/*************************************************** GLOBAL **********************************************/
	
	var clients = {};
	var topics = {};
	
	var verbose = false;
	var loopFreq = 50;
	var Queue = {};

	//login + mdp = token = identification
	function newMessage(message, meta){
				
		var data = shared.incomingMsg(message, meta);
		if(!data){
			upError('Empty parse result', 0)
			return;
		}
				
		try{
			
			// If it's me ?!
			if(data.from == shared.id()){
				console['warn']("Speak to myself, something weird is going one");
				return;
			}
			
			// If it's the first time this client show
			if(!clients[data.from]){
				clients[data.from] = {
					id : -1,
					address : -1,
					port : -1,
					subscribed : {},
					pushed : {},
					startDate : Date.now(),
					lastPush : Date.now(),
					lastPing : Date.now(),
					token : crypto.randomBytes(8).toString('hex'),
				};
				clients[data.from].pushed['/CORE/all'] = 0;
			}
			
			clients[data.from].id = meta.id;
			clients[data.from].type = meta.type;
			clients[data.from].address = meta.address;
			clients[data.from].ip = meta.ip;
			clients[data.from].port = meta.port;
			clients[data.from].lastPush = Date.now();
			clients[data.from].lastPing = Date.now();
			clients[data.from].pushed['/CORE/all'] += 1;
			
			if(!clients[data.from].pushed[data.topic] ){
				clients[data.from].pushed[data.topic] = 0;
			}
			clients[data.from].pushed[data.topic] += 1;

			//Manage topics data
			if(!topics[data.topic]){
				topics[data.topic] = {
					nbMsg : 0,
					subscriber : {},
					publisher : {},
					startDate : Date.now(),
					lastMsg : Date.now(),
				};
			}
			
			topics[data.topic].nbMsg += 1;
			topics[data.topic].lastMsg = Date.now();
			
			if(!topics[data.topic].publisher[data.from]){
				topics[data.topic].publisher[data.from] = 0;
			}
			topics[data.topic].publisher[data.from] += 1;
			

			//Manage authentification
			if(data.topic == '/login'){
				if(data.pswrd && data.from){
					if(data.pswrd == param.pswrd){
						var msg = {};
						msg.token = crypto.randomBytes(8).toString('hex');
						msg.for = data.from;
						shared.publish('/login', msg);
						clients[data.from].token = msg.token;
					}
				}
			//Manage ping			
			}else{			
				if(data.token == clients[data.from].token){
					delete data.token;
					shared.publish(data.topic, data, true);
				}else{
					upError('INVALID TOKEN from ' + data.from + ' on ' + data.topic, 0)
					var msg = {};
					msg.for = data.from;
					shared.publish('/invalid', msg);
				}
			}
						
		}catch(err){
			upError(err, 1);
		}
		
		//CORE cmd
		if(data.ask){	
			var msg = {}
			switch(data.topic) {
				case '/CORE/info':
					msg.clients = clients;
					msg.topics = topics;
					shared.publish('/CORE/info', msg);
					break;
				case '/CORE/clients':
					msg.clients = clients;
					shared.publish('/CORE/clients', msg);
					break;
				case '/CORE/topics':
					msg.topics = topics;
					shared.publish('/CORE/topics', msg);
					break;
				default:
					return;
			}			
		}
		
	};

	



	function propage(data){
		try {	

			var txt = JSON.stringify(data.d);
			let msg = new Buffer.alloc(txt.length, txt); 
			
			for(var cli in clients) {
				
				if(data.d.for){
					if(cli != data.d.for){
						continue;
					}
				}
				
				if(clients[cli].id && clients[cli].type && server[clients[cli].id]){
					if(clients[cli].type == "udp"){								
						server[clients[cli].id].send(msg, 0, msg.length, clients[cli].port, clients[cli].address, function(err, bytes) {
							if (err) {
								console['warn']("UDP error, remove");
								delete server[clients[cli].id];
								throw err;
							}
						});
					}else if(clients[cli].type == "ws"){
						if(server[clients[cli].id].readyState == 1){
							server[clients[cli].id].send(msg.toString(), function(err){
								if (err) {
									console['warn']("Websocket error, remove");
									delete server[clients[cli].id];
									throw err;
								}
							});
						}else{
							console['warn']("Websocket closed, remove");
							delete server[clients[cli].id];
						}
					}
				}

			}
			
			
		}catch(err){
			upError(err, 1);
		}
	};

	var pingTimeout = 4000;
	setInterval(function() { 
		for(var cli in clients) {
			if (Date.now() - clients[cli].lastPing > pingTimeout){
				console['warn']("Client " + cli + " ping timeout, remove");
				delete clients[cli];
			}
		}
		var msg = {
			ask: true
		};
		shared.publish('/CORE/ping', msg);
	}, pingTimeout);

	
	this.setLoop = function(delay){
		loopFreq = delay;
	};	
	
	function loop() {
		setTimeout(function() {
			for(var ms in Queue){	
				propage(Queue[ms]);	
			}
			Queue = {};
			loop();
		}, loopFreq);
	};
	
	this.clients = function(){
		return clients;
	};
	
	this.topics = function(){
		return topics;
	};	
	
	this.resetClients = function(){
		clients = {};
	};
	
	this.resetTopics = function(){
		topics = {};
	};	
	
	this.reset = function(){
		clients = {};
		topics = {};
	};	
	
	this.logOut = function(cli){
		if(clients[cli]){
			client[cli].token = crypto.randomBytes(8).toString('hex');
		}
	};
	
	/***************************************** SHARED **********************************************/
	
	this.publish = function(topic, msg){		
		return shared.publish(topic, msg);
	};

	this.subscribe = function(topic, callback){	
		return shared.subscribe(topic, callback);	
	};	
	
	this.unsubscribe = function(topic){
		return shared.unsubscribe(topic);	
	};
 	
	this.error = function(txt) {
		return shared.error(txt);	
	};
	
	this.warn = function(txt) {
		return shared.warn(txt);	
	};
	
	this.log = function(txt) {
		return shared.log(txt);
	};

	this.name = function() {
		return shared.name();
	};	
	
	this.id = function() {
		return shared.id();
	};
	
	this.ip = function() {
		return shared.ip();
	};
	
}

module.exports = core;