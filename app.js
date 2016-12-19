'use strict';

const 
  bodyParser = require('body-parser'),
  crypto = require('crypto'),
  express = require('express'),
  https = require('https'),  
  request = require('request');
  var sleep = require('sleep');
  
const {Wit, log} = require('node-wit');

var app = express();
app.set('port', process.env.PORT || 5000);
app.set('view engine', 'ejs');
app.use(bodyParser.json({ verify: verifyRequestSignature }));
app.use(express.static('public'));

//----------------------------------------------------------------------------


//For sms
var PythonShell = require('python-shell');
var shell = new PythonShell('sms.py',{ mode: 'text '});



//------------------------------------------------------------------------
var users = []		// array maintaining the fb user ids of the people who learn 	
var left  = []		// array maintaining the module where they left
var currentlydoing = []		// array maintaining the current module which the user is doing
var question = [] 		// array maintaining the part of the current module which the user is doing
var qdone = []



// App Secret can be retrieved from the App Dashboard
const APP_SECRET = "720fee229d00f11ad16a9f5b336703b7";

// Arbitrary value used to validate a webhook
const VALIDATION_TOKEN = "megha";

// Generate a page access token for your page from the App Dashboard
const PAGE_ACCESS_TOKEN = "EAAM8xfaGH14BAAi7tFNtbKcm9vffns1C2xbSDNiXViZAQOkRtvhjVXWMppBbbZA5Ihc9WVQ597zZBvAO6ZBv5byvmVtUHQOSMl1ji4n0dq9AvWfmu13gS9yNhSkZBWOJMqLNdeWKLM6vdF4fIZAanAv7XpsqPOWv2lSUsEc3lKGKyWMBHCIlkt";

// URL where the app is running (include protocol). Used to point to scripts and 
// assets located at this address. 
const SERVER_URL = "http://bot-92794.onmodulus.net";

if (!(APP_SECRET && VALIDATION_TOKEN && PAGE_ACCESS_TOKEN && SERVER_URL)) {
  console.error("Missing config values");
  process.exit(1);
}

// Here facebook verifies that it is sending messages to the correct server 
app.get('/webhook', function(req, res) {
  if (req.query['hub.mode'] === 'subscribe' &&
      req.query['hub.verify_token'] === VALIDATION_TOKEN) {
    console.log("Validating webhook");
    res.status(200).send(req.query['hub.challenge']);
  } else {
    console.error("Failed validation. Make sure the validation tokens match.");
    res.sendStatus(403);          
  }  
});


/*
 * All callbacks for Messenger are POST-ed here!
 */
app.post('/webhook', function (req, res) {
  var data = req.body;

  // Make sure this is a page subscription
  if (data.object == 'page') {
    // Iterate over each entry
    // There may be multiple if batched
    data.entry.forEach(function(pageEntry) {
      var pageID = pageEntry.id;
      var timeOfEvent = pageEntry.time;

      // Iterate over each messaging event
      pageEntry.messaging.forEach(function(messagingEvent) {
        if (messagingEvent.optin) {
          receivedAuthentication(messagingEvent);
        } else if (messagingEvent.message) {
          receivedMessage(messagingEvent);
        } else if (messagingEvent.delivery) {
          receivedDeliveryConfirmation(messagingEvent);
        } else if (messagingEvent.postback) {
          receivedPostback(messagingEvent);
        } else if (messagingEvent.read) {
          receivedMessageRead(messagingEvent);
        } else if (messagingEvent.account_linking) {
          receivedAccountLink(messagingEvent);
        } else {
          console.log("Webhook received unknown messagingEvent: ", messagingEvent);
        }
      });
    });

    // Assume all went well.
    // You must send back a 200, within 20 seconds, to let us know you've 
    // successfully received the callback. Otherwise, the request will time out.
    res.sendStatus(200);
  }
});

/*
 * This path is used for account linking. The account linking call-to-action
 * (sendAccountLinking) is pointed to this URL. 
 * 
 */
app.get('/authorize', function(req, res) {
  var accountLinkingToken = req.query.account_linking_token;
  var redirectURI = req.query.redirect_uri;

  // Authorization Code should be generated per user by the developer. This will 
  // be passed to the Account Linking callback.
  var authCode = "1234567890";

  // Redirect users to this URI on successful login
  var redirectURISuccess = redirectURI + "&authorization_code=" + authCode;

  res.render('authorize', {
    accountLinkingToken: accountLinkingToken,
    redirectURI: redirectURI,
    redirectURISuccess: redirectURISuccess
  });
});

/*
 * Verify that the callback came from Facebook. Using the App Secret from 
 * the App Dashboard, we can verify the signature that is sent with each 
 * callback in the x-hub-signature field, located in the header.
 *
 * https://developers.facebook.com/docs/graph-api/webhooks#setup
 *
 */
function verifyRequestSignature(req, res, buf) {
  var signature = req.headers["x-hub-signature"];

  if (!signature) {
    // For testing, let's log an error. In production, you should throw an 
    // error.
    console.error("Couldn't validate the signature.");
  } else {
    var elements = signature.split('=');
    var method = elements[0];
    var signatureHash = elements[1];

    var expectedHash = crypto.createHmac('sha1', APP_SECRET)
                        .update(buf)
                        .digest('hex');

    if (signatureHash != expectedHash) {
      throw new Error("Couldn't validate the request signature.");
    }
  }
}

/*
 * Authorization Event
 *
 * The value for 'optin.ref' is defined in the entry point. For the "Send to 
 * Messenger" plugin, it is the 'data-ref' field. Read more at 
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/authentication
 *
 */
function receivedAuthentication(event) {
  var senderID = event.sender.id;
  var recipientID = event.recipient.id;
  var timeOfAuth = event.timestamp;

  // The 'ref' field is set in the 'Send to Messenger' plugin, in the 'data-ref'
  // The developer can set this to an arbitrary value to associate the 
  // authentication callback with the 'Send to Messenger' click event. This is
  // a way to do account linking when the user clicks the 'Send to Messenger' 
  // plugin.
  var passThroughParam = event.optin.ref;

  console.log("Received authentication for user %d and page %d with pass " +
    "through param '%s' at %d", senderID, recipientID, passThroughParam, 
    timeOfAuth);

  // When an authentication is received, we'll send a message back to the sender
  // to let them know it was successful.
  sendTextMessage(senderID, "Authentication successful");
}

/*
 * Message Event
 *
 * This event is called when a message is sent to your page. The 'message' 
 * object format can vary depending on the kind of message that was received.
 * Read more at https://developers.facebook.com/docs/messenger-platform/webhook-reference/message-received
 *
 * For this example, we're going to echo any text that we get. If we get some 
 * special keywords ('button', 'generic', 'receipt'), then we'll send back
 * examples of those bubbles to illustrate the special message bubbles we've 
 * created. If we receive a message with an attachment (image, video, audio), 
 * then we'll simply confirm that we've received the attachment.
 * 
 */
 
 
 function testlevel(senderID,intent)			//1
 {


 }
 
 
 function learncounting(senderID,intent)		//2
 {
	 sendVideoMessage(senderID,"LearnCounting.mp4");
	 sendTextMessage(senderID,"Here are the charts for you to learn from! I'm praparing a video lesson for you on Counting... :) I hope you'll be able to understand everything from it! ");
	 sendImageMessage(senderID,"numberchart2.jpg"); 
	 sendImageMessage(senderID,"numberchart11.jpg"); 
 }
 
 
 
 function practicecounting(senderID,intent)	//3
 {
	 
 }
 
 function learnods(senderID,intent)			//4
 {
		 sendVideoMessage(senderID,"LearnOneDigitSubtraction.mp4");
	 	 sendTextMessage(senderID,"I'm praparing a video lesson for you on One-Digit Subtraction... :) I hope you'll be able to understand everything from it! ");
 }


 
 function practiceods(senderID,intent)			//5
 {
	 
 }
 

 
 function learntds(senderID,intent)			//6
 {
	 sendVideoMessage(senderID,"LearnTwoDigitSubtraction.mp4");
	 sendTextMessage(senderID,"I have a video lesson for you on Two-Digit Subtraction... :) You'll be able to understand everything from it! ");
 }
 

 function practicetds(senderID,intent)			//7
 {
	 
 }
 

function receivedMessage(event) {
  var senderID = event.sender.id;
  var recipientID = event.recipient.id;
  var timeOfMessage = event.timestamp;
  var message = event.message;

  console.log("Received message for user %d and page %d at %d with message:", 
    senderID, recipientID, timeOfMessage);
  console.log(JSON.stringify(message));

  var isEcho = message.is_echo;
  var messageId = message.mid;
  var appId = message.app_id;
  var metadata = message.metadata;
  
    // You may get a text or attachment but not both
  var messageText = message.text;
  var messageAttachments = message.attachments;
  var quickReply = message.quick_reply;
  
  if (isEcho) {
    // Just logging message echoes to console
    console.log("Received echo for message %s and app %d with metadata %s", 
      messageId, appId, metadata);
    return;
  } else if (quickReply) {
    var quickReplyPayload = quickReply.payload;
    console.log("Quick reply for message %s with payload %s",
      messageId, quickReplyPayload);

    sendTextMessage(senderID, "Quick reply tapped");
    return;
  }


  //sendTextMessage(senderID, "Working");
  //return;
		
  if (messageText) {
    //---------------------------------Interaction with WIT AI--------------------------------------------------
    
    var reply = "I'm sorry! I didn't understand! :(";
    var resp = "I'm sorry! I didn't understand! :(";
    const client = new Wit({accessToken: "4LCJ5BDKFED7MU4VDATBSF6NRLGFKZID"});
	client.message(messageText, {})
	.then((data) => {
	console.log('Yay, got Wit.ai response: ' + (reply = JSON.stringify(data)));
	
	reply = data;
	
	var intent = Object.keys(reply['entities']); 	// intent is an array of intents possesed by the sentence
	
	/*
	 * Possible intents:
	 * 
	 * Hello...				go					oneWordODS
	 * 
	 * learning				learnODS			login
	 * 
	 * repeat				signUp				no
	 * 
	 * thanking				learnW...				greeting...
	 * 
	 * compliment			practiceW			yes
	 * 
	 * oneWordTDS...			practiceODS			practiceCount
	 * 
	 * oneWordCount...			learnTDS...			learnCount...
	 * 
	 * practiceTDS					
	 * 
	 * */
	//sendTextMessage(senderID,intent);
	var x;
	if (intent.length == 0)
	{
		sendTextMessage(senderID,"I'm sorry! I didn't understand! I know I'm not that good! :( I will ask him to help you out!");
		shell.send('9569252871');
		return;
	}
	
	if (intent.length == 1 && intent[0]=='greeting')
	{
		var ans1 = "I'm very good!\nLooking forward to teach you counting! :* 3:)";
		sendTextMessage(senderID, ans1);
		//sendImageMessage(senderID,"7.jpg");
	}
	if (intent.length == 1 && intent[0]=='compliment')
		{
			var ans1 = "I'm happy that you liked my way of teaching ! B) \n I'm happy that the 'count' of my good students is increasing ! :P :P";
			sendTextMessage(senderID, ans1);
		}
	if (intent.length == 1 && intent[0]=='thanking')
		{
			var ans1 = "You're welcome <3 <3 .\n";
			sendTextMessage(senderID, ans1);
		}
	if (intent.length == 1 && intent[0]=='go')
		{
			var ans1 = ":( :( :(... \n Come back Soon! Bye!";
			sendTextMessage(senderID, ans1);
			shell.send('9888552871');
			//currentlydoing[users.indexOf(senderID)] = 1;
			//left[users.indexOf(senderID)] = currentlydoing[users.indexOf(senderID)] ;
			return;
		}
	if (intent[0]=='Hello')
	{
		var ans1 = "Heyyy! Great to see you! :* :* A rose for you!";
		sendTextMessage(senderID, ans1);
		sendImageMessage(senderID,"rose.jpg"); 
	}
	
	if (intent.indexOf('oneWordTDS')!=-1)
	{
		learntds(senderID,intent,messageText);
	}
	if (intent.indexOf('learnTDS')!=-1)
	{
		learntds(senderID,intent,messageText);
	}
	if (intent.indexOf('oneWordCount')!=-1)
	{
		learncounting(senderID,intent,messageText);
	}
	if (intent.indexOf('learnCount')!=-1)
	{
		learncounting(senderID,intent,messageText);
	}
	if (intent.indexOf('learnODS')!=-1)
	{
		learnods(senderID,intent,messageText);
	}
	if (intent.indexOf('oneWordODS')!=-1)
	{
		learnods(senderID,intent,messageText);
	}
	if (intent.indexOf('learnW')!=-1)
	{
		sendTextMessage(senderID,"What do you want to learn...? Counting, One-Digit Subtraction or Two-Digit Subtraction!");
	}
	if (intent.indexOf('repeat')!=-1)
	{
		sendTextMessage(senderID,"Tell me what do you want me to repeat! Counting, One-Digit Subtraction or Two-Digit Subtraction!");
	}
	return;
	
	})
	.catch(console.error);
}
  else if (messageAttachments) {
    sendTextMessage(senderID, "I can't understand pictures! I'm not that good yet! :( :(");
  }


}

/*
 * Delivery Confirmation Event
 *
 * This event is sent to confirm the delivery of a message. Read more about 
 * these fields at https://developers.facebook.com/docs/messenger-platform/webhook-reference/message-delivered
 *
 */
function receivedDeliveryConfirmation(event) {
  var senderID = event.sender.id;
  var recipientID = event.recipient.id;
  var delivery = event.delivery;
  var messageIDs = delivery.mids;
  var watermark = delivery.watermark;
  var sequenceNumber = delivery.seq;

  if (messageIDs) {
    messageIDs.forEach(function(messageID) {
      console.log("Received delivery confirmation for message ID: %s", 
        messageID);
    });
  }

  console.log("All message before %d were delivered.", watermark);
}


/*
 * Postback Event
 *
 * This event is called when a postback is tapped on a Structured Message. 
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/postback-received
 * 
 */
function receivedPostback(event) {
  var senderID = event.sender.id;
  var recipientID = event.recipient.id;
  var timeOfPostback = event.timestamp;

  // The 'payload' param is a developer-defined field which is set in a postback 
  // button for Structured Messages. 
  var payload = event.postback.payload;

  console.log("Received postback for user %d and page %d with payload '%s' " + 
    "at %d", senderID, recipientID, payload, timeOfPostback);

  // When a postback is called, we'll send a message back to the sender to 
  // let them know it was successful
  sendTextMessage(senderID, "Postback called");
}

/*
 * Message Read Event
 *
 * This event is called when a previously-sent message has been read.
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/message-read
 * 
 */
function receivedMessageRead(event) {
  var senderID = event.sender.id;
  var recipientID = event.recipient.id;

  // All messages before watermark (a timestamp) or sequence have been seen.
  var watermark = event.read.watermark;
  var sequenceNumber = event.read.seq;

  console.log("Received message read event for watermark %d and sequence " +
    "number %d", watermark, sequenceNumber);
}

/*
 * Account Link Event
 *
 * This event is called when the Link Account or UnLink Account action has been
 * tapped.
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/account-linking
 * 
 */
function receivedAccountLink(event) {
  var senderID = event.sender.id;
  var recipientID = event.recipient.id;

  var status = event.account_linking.status;
  var authCode = event.account_linking.authorization_code;

  console.log("Received account link event with for user %d with status %s " +
    "and auth code %s ", senderID, status, authCode);
}

/*
 * Send an image using the Send API.
 *
 */
function sendImageMessage(recipientId,u) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      attachment: {
        type: "image",
        payload: {
          url:  SERVER_URL + "/assets/" + u
        }
      }
    }
  };

  callSendAPI(messageData);
}

/*
 * Send a Gif using the Send API.
 *
 */
function sendGifMessage(recipientId,u) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      attachment: {
        type: "image",
        payload: {
          url: SERVER_URL + "/assets/" + u
        }
      }
    }
  };

  callSendAPI(messageData);
}

/*
 * Send audio using the Send API.
 *
 */
function sendAudioMessage(recipientId,u) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      attachment: {
        type: "audio",
        payload: {
          url: SERVER_URL + "/assets/" + u
        }
      }
    }
  };

  callSendAPI(messageData);
}

/*
 * Send a video using the Send API.
 *
 */
function sendVideoMessage(recipientId,u) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      attachment: {
        type: "video",
        payload: {
          url: SERVER_URL + "/assets/" + u
        }
      }
    }
  };

  callSendAPI(messageData);
}

/*
 * Send a file using the Send API.
 *
 */
function sendFileMessage(recipientId,u) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      attachment: {
        type: "file",
        payload: {
          url: SERVER_URL + "/assets/" + u
        }
      }
    }
  };

  callSendAPI(messageData);
}

/*
 * Send a text message using the Send API.
 *
 */
function sendTextMessage(recipientId, messageText) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      text: messageText,
      metadata: "DEVELOPER_DEFINED_METADATA"
    }
  };

  callSendAPI(messageData);
}

/*
 * Send a button message using the Send API.
 *
 */
function sendButtonMessage(recipientId) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      attachment: {
        type: "template",
        payload: {
          template_type: "button",
          text: "This is test text",
          buttons:[{
            type: "web_url",
            url: "https://www.oculus.com/en-us/rift/",
            title: "Open Web URL"
          }, {
            type: "postback",
            title: "Trigger Postback",
            payload: "DEVELOPER_DEFINED_PAYLOAD"
          }, {
            type: "phone_number",
            title: "Call Phone Number",
            payload: "+16505551234"
          }]
        }
      }
    }
  };  

  callSendAPI(messageData);
}

/*
 * Send a Structured Message (Generic Message type) using the Send API.
 *
 */
function sendGenericMessage(recipientId) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      attachment: {
        type: "template",
        payload: {
          template_type: "generic",
          elements: [{
            title: "rift",
            subtitle: "Next-generation virtual reality",
            item_url: "https://www.oculus.com/en-us/rift/",               
            image_url: SERVER_URL + "/assets/rift.png",
            buttons: [{
              type: "web_url",
              url: "https://www.oculus.com/en-us/rift/",
              title: "Open Web URL"
            }, {
              type: "postback",
              title: "Call Postback",
              payload: "Payload for first bubble",
            }],
          }, {
            title: "touch",
            subtitle: "Your Hands, Now in VR",
            item_url: "https://www.oculus.com/en-us/touch/",               
            image_url: SERVER_URL + "/assets/touch.png",
            buttons: [{
              type: "web_url",
              url: "https://www.oculus.com/en-us/touch/",
              title: "Open Web URL"
            }, {
              type: "postback",
              title: "Call Postback",
              payload: "Payload for second bubble",
            }]
          }]
        }
      }
    }
  };  

  callSendAPI(messageData);
}

/*
 * Send a receipt message using the Send API.
 *
 */
function sendReceiptMessage(recipientId) {
  // Generate a random receipt ID as the API requires a unique ID
  var receiptId = "order" + Math.floor(Math.random()*1000);

  var messageData = {
    recipient: {
      id: recipientId
    },
    message:{
      attachment: {
        type: "template",
        payload: {
          template_type: "receipt",
          recipient_name: "Peter Chang",
          order_number: receiptId,
          currency: "USD",
          payment_method: "Visa 1234",        
          timestamp: "1428444852", 
          elements: [{
            title: "Oculus Rift",
            subtitle: "Includes: headset, sensor, remote",
            quantity: 1,
            price: 599.00,
            currency: "USD",
            image_url: SERVER_URL + "/assets/riftsq.png"
          }, {
            title: "Samsung Gear VR",
            subtitle: "Frost White",
            quantity: 1,
            price: 99.99,
            currency: "USD",
            image_url: SERVER_URL + "/assets/gearvrsq.png"
          }],
          address: {
            street_1: "1 Hacker Way",
            street_2: "",
            city: "Menlo Park",
            postal_code: "94025",
            state: "CA",
            country: "US"
          },
          summary: {
            subtotal: 698.99,
            shipping_cost: 20.00,
            total_tax: 57.67,
            total_cost: 626.66
          },
          adjustments: [{
            name: "New Customer Discount",
            amount: -50
          }, {
            name: "$100 Off Coupon",
            amount: -100
          }]
        }
      }
    }
  };

  callSendAPI(messageData);
}

/*
 * Send a message with Quick Reply buttons.
 *
 */
function sendQuickReply(recipientId) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      text: "What's your favorite movie genre?",
      quick_replies: [
        {
          "content_type":"text",
          "title":"Action",
          "payload":"DEVELOPER_DEFINED_PAYLOAD_FOR_PICKING_ACTION"
        },
        {
          "content_type":"text",
          "title":"Comedy",
          "payload":"DEVELOPER_DEFINED_PAYLOAD_FOR_PICKING_COMEDY"
        },
        {
          "content_type":"text",
          "title":"Drama",
          "payload":"DEVELOPER_DEFINED_PAYLOAD_FOR_PICKING_DRAMA"
        }
      ]
    }
  };

  callSendAPI(messageData);
}

/*
 * Send a read receipt to indicate the message has been read
 *
 */
function sendReadReceipt(recipientId) {
  console.log("Sending a read receipt to mark message as seen");

  var messageData = {
    recipient: {
      id: recipientId
    },
    sender_action: "mark_seen"
  };

  callSendAPI(messageData);
}

/*
 * Turn typing indicator on
 *
 */
function sendTypingOn(recipientId) {
  console.log("Turning typing indicator on");

  var messageData = {
    recipient: {
      id: recipientId
    },
    sender_action: "typing_on"
  };

  callSendAPI(messageData);
}

/*
 * Turn typing indicator off
 *
 */
function sendTypingOff(recipientId) {
  console.log("Turning typing indicator off");

  var messageData = {
    recipient: {
      id: recipientId
    },
    sender_action: "typing_off"
  };

  callSendAPI(messageData);
}

/*
 * Send a message with the account linking call-to-action
 *
 */
function sendAccountLinking(recipientId) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      attachment: {
        type: "template",
        payload: {
          template_type: "button",
          text: "Welcome. Link your account.",
          buttons:[{
            type: "account_link",
            url: SERVER_URL + "/authorize"
          }]
        }
      }
    }
  };  

  callSendAPI(messageData);
}

/*
 * Call the Send API. The message data goes in the body. If successful, we'll 
 * get the message id in a response 
 *
 */
function callSendAPI(messageData) {
  request({
    uri: 'https://graph.facebook.com/v2.6/me/messages',
    qs: { access_token: PAGE_ACCESS_TOKEN },
    method: 'POST',
    json: messageData

  }, function (error, response, body) {
    if (!error && response.statusCode == 200) {
      var recipientId = body.recipient_id;
      var messageId = body.message_id;

      if (messageId) {
        console.log("Successfully sent message with id %s to recipient %s", 
          messageId, recipientId);
      } else {
      console.log("Successfully called Send API for recipient %s", 
        recipientId);
      }
    } else {
      console.error("Failed calling Send API", response.statusCode, response.statusMessage, body.error);
    }
  });  
}

// Start server
// Webhooks must be available via SSL with a certificate signed by a valid 
// certificate authority.

app.listen(process.env.PORT || 3000)
module.exports = app;
