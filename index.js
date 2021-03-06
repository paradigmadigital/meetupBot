const co = require('co');
const request = require('request');
const runtimeConfig = require('cloud-functions-runtime-config');
const moment = require('moment');

const MAX_DATE = '12/31/2040';


/**
 * Retrieves the parameters from the request argument
 *
 * @param request
 * @returns {any}
 */
function getParameters(request) {
    return request.body.queryResult.parameters;
}

/**
 * Evaluate if value is undefined
 * @param value value to check
 * @returns {boolean} true if is defined, false in other case
 */
function isUndefined(value) {
    return typeof value === 'undefined';
}

/**
 * Retrieves the topic from the parameter object
 * @param parameters request's parameters
 * @returns topic or empty string
 */
function getTopic(parameters) {
    if (!isUndefined(parameters.Topic)) {
        return parameters.Topic;
    }
    else {
        return '';
    }
}

/**
 * Retrieves the startDate from the date-period parameter
 * @param parameters
 * @returns {Date}
 */
function getDateFrom(parameters) {
    return moment(parameters['date-period'].startDate);
}

/**
 * Retrieves the endDate from the date-period parameter
 * @param parameters
 * @returns {Date}
 */
function getDateTo(parameters) {
    return moment(parameters['date-period'].endDate);
}

/**
 * Function to order two dates
 * @param dateA
 * @param dateB
 * @returns {number}
 */
function orderDateAsc(eventA, eventB) {
    return eventA.eventDate - eventB.eventDate;
}

/**
 * This functions checks if the meetup has an event
 * @param meetup
 * @returns {boolean}
 */
function meetupsWithEventAvailable(meetup) {
    return !isUndefined(meetup.next_event);
}


/**
 * This functions transforms a meetup with the meetup.com API format to our own detailed format
 * @param meetup API format
 * @returns {{name: *, link: *, eventName: string, eventDate: Date}}
 */
function meetupAPItoMeetupDetail(meetup) {
    let detail = {
        name: meetup.name,
        link: meetup.link,
        eventName: isUndefined(meetup.next_event.name) ? 'error' : meetup.next_event.name,
        eventDate: moment(meetup.next_event.time)
    };
    return detail;
}

/**
 * This function call meetup.com api and returns all the available meetups.
 * @returns meetups
 */
function getMeetups(uri) {
    return new Promise((resolve, reject) => {
        request(uri, function (error, response, body) {
            if (error) {
                reject(error);
            } else {
                let meetups = JSON.parse(body);
                console.log(JSON.stringify(meetups));
                resolve(meetups);
            }
        });
    });
}

/**
 * Transform the answer into a humand-understandable reply
 * @param req request
 * @param responseJson JSON with the answer from meetup.com
 * @returns {string} user response
 */

function humanizeResponse(req, responseJson) {

    const parameters = getParameters(req);
    let requestSource = (req.body.originalDetectIntentRequest) ? req.body.originalDetectIntentRequest.source : undefined;


    let responseText = '';
    let extraInfo = '';

    topic = getTopic(parameters);

    //Header info
    if (topic !== '') {
        extraInfo += ' sobre ' + topic;
    }

    if (parameters['date-period'] !== '') {
        extraInfo += ' entre '+ getDateFrom(parameters).format('DD/MM/YY') + ' y ' + getDateTo(parameters).format('DD/MM/YY');
    }

    //Detail info
    if (responseJson.length > 0) {

        responseText = 'He encontrado ' + responseJson.length + ' resultados ' + extraInfo + '. Son los siguientes :\n';


        //Tendremos 2 respuestas. Una para google assistant, preparada para ser leída y otra para slack, preparada para hacer click.
        responseJson.forEach(function (detail) {
            if (requestSource === 'google') {
                responseText = responseText.concat('El grupo ' + detail.name + ' organiza ' + detail.eventName + ' el próximo día ' + detail.eventDate.format('DD/MM/YY') + '.\n');
            }
            else {
                responseText = responseText.concat('<' + detail.link + ' | ' + detail.name + '> - ' +
                    '*' + detail.eventName + '* el próximo día ' + detail.eventDate.format('DD/MM/YY') + '\n');
            }
        });


    } else { //Data not found

        responseText = 'Lo siento no he podido encontrar nada' + extraInfo;
    }


    return responseText;

}


/**
 * Responds to any HTTP request that can provide a "message" field in the body.
 *
 * @param {!Object} req Cloud Function request context.
 * @param {!Object} res Cloud Function response context.
 */
exports.meetup = (req, res) => {


    //Response
    let assistantResponse = {
        fulfillmentText: ''
    };


    const parameters = getParameters(req);


    topic = getTopic(parameters);
    dateFrom = (parameters['date-period'] === '') ? moment() : getDateFrom(parameters);
    dateTo = (parameters['date-period'] === '') ? moment(MAX_DATE) : getDateTo(parameters);


    const topicParam = (topic === '') ? '' : '&text=' + topic;

    co(function* () {
        let apiKey = yield runtimeConfig.getVariable('dev-config', 'api-key');

        const API_URL = 'https://api.meetup.com/';
        const FIND_GROUPS = 'find/groups?';
        const KEY = 'key=' + apiKey + '&sign=true';
        const ZIP = '&zip=meetup1';
        const FILTER_FIELDS = '&only=score,name,link,city,next_event';
        const MAX_PAGE = '&page=50';
        const TECH_CATEGORY = '&category=34';

        const params = KEY + ZIP + TECH_CATEGORY + topicParam + FILTER_FIELDS + MAX_PAGE;


        console.log(API_URL + FIND_GROUPS + params);

        //Invoking API meetup.com and processing the result
        let meetups = yield getMeetups(API_URL + FIND_GROUPS + params);

        let responseJson = meetups
                .filter(meetupsWithEventAvailable)
                .filter((meetup) =>  moment(meetup.next_event.time).isBetween(dateFrom,dateTo))
                .map(meetupAPItoMeetupDetail);

        responseJson.sort(orderDateAsc);

        assistantResponse.fulfillmentText = humanizeResponse(req, responseJson);

        res.status(200).send(assistantResponse);
        
    }).catch((err) => {
        res.status(500).send(err);
    });

}
