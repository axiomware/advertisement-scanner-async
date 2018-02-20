// Copyright 2017,2018 Axiomware Systems Inc. 
//
// Licensed under the MIT license <LICENSE-MIT or 
// http://opensource.org/licenses/MIT>. This file may not be copied, 
// modified, or distributed except according to those terms.
//


//Add external modules dependencies
var netrunr = require('netrunr-gapi-async');
var inquirer = require('inquirer');
var chalk = require('chalk');
var figlet = require('figlet');


//Gobal variables
const gapiAsync = new netrunr('');//Create an instance  Netrunr gateway object
var exitFlag = false;                                   //set flag when exiting

//User configuration
var userConfig = {           
    'scanPeriod': 1,    // seconds of advertising scan
    'scanMode': 1,      // 1-> active, 0-> passive
};

//Used to monitor for ctrl-c and exit program
process.on("SIGINT", function () {
    axShutdown("Received Ctrl-C - shutting down.. please wait");
});

// Ensure any unhandled promise rejections get logged.
process.on('unhandledRejection', err => {
    axShutdown("Unhandled promise rejection - shutting down.. " + + JSON.stringify(err, Object.getOwnPropertyNames(err)));
})

//Application start
console.log(chalk.green.bold(figlet.textSync('NETRUNR GATEWAY', { horizontalLayout: 'default' })));
console.log(chalk.green.bold('Advertisement Scanner (Async version) Application'));
console.log(chalk.red.bold('Press Ctrl-C to exit'));
main(); // Call main function


/**
 * Main program entry point
 * Using Command Line Interface (CLI), get user credentails
 * 
 */
async function main() {
    try {
        let cred = await axmUIgetAxiomwareCredentials(); // get user credentials
        let gwList = await gapiAsync.login({ 'user': cred.user, 'pwd': cred.pwd });//login
        console.log('Login success [user:' + cred.user + ']');

        if(gwList.gwid.length>0) {
            console.log('Found ' + gwList.gwid.length + ' Gateway(s)');
            gwList.gwid.forEach(function (gw) { console.log(gw) }); // print gateway list

            let gwid = gwList.gwid[0];//Select the first gateway to connect
            gapiAsync.config({ 'gwid': gwid });  //select gateway first in the list
            await gapiAsync.open({});                   //open connection to gateway
            console.log('Connection open to Netrunr gateway [' + gwid + '] success!')

            console.log('Fetching version info of [gwid:' + gwid + ']');
            let robj = await gapiAsync.version(5000);                              //Check gateway version - if gateway is not online(err), exit 
            console.log('Netrunr gateway [' + gwid + '] version = ' + robj.version);

            gapiAsync.event({ 'did': '*' }, myGatewayEventHandler, null);     //Attach event handlers
            gapiAsync.report({ 'did': '*' }, myGatewayReportHandler, null);  //Attach report handlers
            axScanForBLEdev();                                          //Scan for advertisements
        }
        else {
            await axShutdown('Found no gateways - exiting (nothing to do)');
        }
    } catch (err) {
        await axShutdown('Error! Exiting... ' + JSON.stringify(err, Object.getOwnPropertyNames(err)));//Error - exit
    }
}

/**
 * Scan for BLE devices and generate "scan complete" event at the end of scan
 * 
 */
async function axScanForBLEdev(advScanParam) {
    try {
        if(!exitFlag) { //Only process new scan requests if we are not exiting the program
            let ret = await gapiAsync.list({ 'active': userConfig.scanMode, 'period': userConfig.scanPeriod });
        }
    } catch (err) {
        console.log('List failed' + JSON.stringify(err, Object.getOwnPropertyNames(err)));
    }
};

/**
 * Event handler (for scan complete, disconnection, etc events)
 * 
 * @param {Object} iobj - Event handler object - see API docs
 */
function myGatewayEventHandler(iobj) {
    switch (iobj.event) {
        case 1: //disconnect event
            console.log('Device disconnect event' + JSON.stringify(iobj, null, 0));
            break;
        case 39://Scan complete event
            axScanForBLEdev();//start new scan
            break;
        default:
            console.log('Other unhandled event [' + iobj.event + ']');
    }
}

/**
 * Report handler (for advertisement data, notification and indication events)
 * 
 * @param {Object} iobj - Report handler object - see API docs 
 */
function myGatewayReportHandler(iobj) {
    switch (iobj.report) {
        case 1://adv report
            var advPrnArray = axParseAdv(iobj.nodes);
            axPrintAdvArray(advPrnArray)
            break;
        case 27://Notification report
            console.log('Notification received: ' + JSON.stringify(iobj, null, 0))
            break;
        default:
            console.log('(Other report) ' + JSON.stringify(iobj, null, 0))
    }
}

/**
 * Gracefully shutdown the connection and logout of the account
 * 
 * @param {string} prnStr - Print this string to console before exiting
 */
async function axShutdown(prnStr) {
    console.log(prnStr);
    exitFlag = true;
    if (gapiAsync.isOpen) {
        await gapiAsync.close({});//close
    }
    if (gapiAsync.isLogin) {
        await gapiAsync.logout({});//logout
    }
    process.exit();//exit the process
};


/**
 * Get user credentails from command line interface (CLI)
 * 
 * @returns {Object} username and password
 */
async function axmUIgetAxiomwareCredentials() {
    var questions = [
        {
            name: 'user',
            type: 'input',
            message: 'Enter your Axiomware account username(e-mail):',
            validate: (email) => { return validateEmail(email) ? true : 'Please enter valid e-mail address'; }
        },
        {
            name: 'pwd',
            type: 'password',
            message: 'Enter your password:',
            validate: (value) => { return (value.length > 0) ? true : 'Please enter your password'; }
        }
    ];

    let answer = await inquirer.prompt(questions);
    return { user: answer.user, pwd: answer.pwd };
}


// Utitlity Functions

/**
 * Format adv packets to print using console.log
 * 
 * @param {Object[]} advArray - Array of advertsisement objects from report callback
 */
function axPrintAdvArray(advArray) {
    for (var i = 0; i < advArray.length; i++) {
        console.log(JSON.stringify(advArray[i], null, 0));
    }
}

/**
 * Parse advertisement packets
 * 
 * @param {Object[]} advArray - Array of advertsisement objects from report callback
 * @returns 
 */
function axParseAdv(advArray) {
    var advArrayMap = advArray.map(axAdvExtractData);//Extract data
    var advArrayFilter = advArrayMap.filter(axAdvMatchAll);//Filter adv
    return advArrayFilter;
}

/**
 * Function to extract advertisement data
 * 
 * @param {Object} advItem - Single advertisement object
 * @returns {Object} advObj - Single parsed advertisement data object
 */
function axAdvExtractData(advItem) {
    advObj = {
        ts: dateTime(advItem.tss + 1e-6 * advItem.tsus),    //Time stamp
        did: addrDisplaySwapEndianness(advItem.did),        //BLE address
        dt: advItem.dtype,                                  // Adress type
        ev: advItem.ev,                                     //adv packet type
        rssi: advItem.rssi,                                 //adv packet RSSI in dBm
        name: axParseAdvGetName(advItem.adv, advItem.rsp),  //BLE device name
        //adv1: advItem.adv,       //payload of adv packet - uncomment to print on screen
        //rsp1: advItem.rsp,       //payload of rsp packet - uncomment to print on screen
    };
    return advObj;
}

/**
 * Function to match all devices(dummy)
 * 
 * @param {any} advItem 
 * @returns {boolean} - true if advertsiment has to be retained
 */
function axAdvMatchAll(advItem) {
    return (true);
}


/**
 * Function to match TI sensorTag, see http://processors.wiki.ti.com/index.php/CC2650_SensorTag_User%27s_Guide
 * 
 * @param {any} advItem 
 * @returns {boolean} - true if advertsiment has to be retained
 */
function axAdvMatchSensorTag(advItem) {
    return (advItem.name == "CC2650 SensorTag");
}


/**
 * Get device name from advertisement packet
 * 
 * @param {Object} adv - Advertisement payload
 * @param {Object} rsp - Scan response payload
 * @returns {string} - Name of the device or null if not present
 */
function axParseAdvGetName(adv, rsp) {
    var didName = '';
    for (var i = 0; i < adv.length; i++) {
        if ((adv[i].t == 8) || (adv[i].t == 9)) {
            didName = adv[i].v;
            return didName;
        }
    }
    for (var i = 0; i < rsp.length; i++) {
        if ((rsp[i].t == 8) || (rsp[i].t == 9)) {
            didName = rsp[i].v;
            return didName;
        }
    }
    return didName;
}

/**
 * Convert unix seconds to time string - local time (yyyy-mm-ddThh:mm:ss.sss).
 * 
 * @param {Number} s - Number is Unix time format
 * @returns {string} - in local time format
 */
function dateTime(s) {
    var d = new Date(s*1000);
    var localISOTime = new Date(d.getTime() - d.getTimezoneOffset() * 60 * 1000).toISOString().slice(0, -1);
    return localISOTime;
}

/**
 * Validate email
 * 
 * @param {string} email - string in valid email format
 * @returns boolean - true if valid email address based on RegEx match
 */
function validateEmail(email) {
    var re = /^(([^<>()[\]\\.,;:\s@\"]+(\.[^<>()[\]\\.,;:\s@\"]+)*)|(\".+\"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
    return re.test(email);
}

/**
 * Swap endianness of a hex-string 
 * 
 * @param {string} hexStr - Hex string(make sure length is even)
 * @returns {string} 
 */
function swapEndianness(hexStr) {
    if (hexStr.length > 2)
        return hexStr.replace(/^(.(..)*)$/, "0$1").match(/../g).reverse().join("");
    else
        return hexStr
}

/**
 * Swap endianness of a hex-string. Format it to standard BLE address style
 * 
 * @param {string} hexStr - Hex string(make sure length is even) 
 * @returns {string}
 */
function addrDisplaySwapEndianness(hexStr) {
    if (hexStr.length > 2)
        return hexStr.replace(/^(.(..)*)$/, "0$1").match(/../g).reverse().join(":").toUpperCase();
    else
        return hexStr
}