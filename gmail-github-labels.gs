// This requires a sheet called gmail-github-labels with configiuration data in the first column
// the following data should be provided
// access_token - a github access token from https://github.com/settings/tokens/new
// me - your github username
// labels - the labels you are interested in having copied over to gmail
// timezone_offset - hours difference from UTC (to work out the date of yesterday).
// repos - the list of repos you want to check issues for (e.g. arkarkark/gmail-github-labels)
//
// lists are provided in one value per cell

var access_token = '';
var me = '';
var github_labels = [];
var timezone_offset = -8;

function getLabelNames() {
  return [].concat(github_labels, 'open,closed,mine'.split(','));
}

function setup() {
  GmailApp.createLabel('github');
  getLabelNames().forEach(function(label) {
    GmailApp.createLabel('github/' + label);
  });
}

function getConfig() {
  var github;
  SpreadsheetApp.getActiveSpreadsheet().getSheets().forEach(function(sheet) {
    if (sheet.getName() == 'gmail-github-labels') {
      github = sheet;
    }
  });
  if (github) {
    Logger.log('found sheet!');
  }
  var values = github.getRange(1, 1, github.getMaxRows() - 1, github.getMaxColumns() - 1).getValues();
  for (var row in values) {
    if (values[row][0]) {
      switch (values[row][0]) {
        case 'access_token': access_token = values[row][1]; break;
        case 'me': me = values[row][1]; break;
        case 'timezone_offset': timezone_offset = values[row][1]; break;
        case 'labels': github_labels = values[row].slice(1).filter(function(x) { return x;}); break;
      }
    }
  }
  Logger.log('all done');
  Logger.log(access_token);
  Logger.log(me);
  Logger.log(timezone_offset);
  Logger.log(JSON.stringify(github_labels));
}


function queryString(params) {
  var qs = [];
  var keys = Object.keys(params);
  for (var i = 0; i < keys.length; i++) {
    qs.push(encodeURIComponent(keys[i]) + '=' + encodeURIComponent(params[keys[i]]));
  }
  return qs.join('&');
}

function github(path, params) {
  params.access_token = access_token;
  var url = 'https://api.github.com' + path + '?' + queryString(params);
  Logger.log('opening: ' + url);
  return JSON.parse(UrlFetchApp.fetch(url).getContentText());
}

function getGmailLabels() {
  labels = {};
  getLabelNames().forEach(function(label) {
    labels['github/' + label] = GmailApp.getUserLabelByName('github/' + label);
  });
  return labels;
}

function processMessage(msg, th, labels, bugs) {
  var content = msg.getPlainBody().split('\n');
  if (!content.length) {
    return false;
  }
  var lastLine = content[content.length - 1];
  var match = lastLine.match(new RegExp('^https://github.com/.*/issues/([0-9]+)'));
  if (!match) {
    return false;
  }
  var bugNum = match[1];
  var bug =  bugs[bugNum];
  if (!bug) {
    return false;
  }
  var threadLabels = th.getLabels();
  Logger.log('bug: ' + bugNum + ' has this many gmail labels: ' + threadLabels.length );
  function label(labelName, on) {
    var gmailLabel = labels['github/' + labelName];
    if (!gmailLabel) {
      return;
    }
    if (threadLabels.indexOf(gmailLabel) == -1) {
      if (on) {
        th.addLabel(gmailLabel);
      }
    } else {
      if (!on) {
        th.removeLabel(gmailLabel);
      }
    }
  }
  var open = bug.state == 'open';
  label('open', open);
  label('closed', !open);
  label('mine', bug.assignee && bug.assignee.login == me);
  bug.labels.forEach(function(l) {
    label(l.name, !open ? false : github_labels.indexOf(l.name) != -1);
  });
  return true;
}

function yesterday() {
  var d = new Date();
  d.setHours(d.getHours() + timezone_offset);
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function processEmails() {
  getConfig();
  labels = getGmailLabels();
  var bugs = {};
  github('/repos/looker/helltool/issues', {'since': yesterday(), 'state': 'all'}).forEach(function(bug) {
    bugs[bug.number] = bug;
  });

  var count = 0;
  GmailApp.search('"view it on github" after:' + yesterday()).forEach(function(th) {
    var msgs = th.getMessages();
    Logger.log(count + ' : ' + msgs.length + ' messages in: ' + th.getFirstMessageSubject());
    if (!msgs.length) {
      return;
    }
    var idx = 0;
    while (idx < msgs.length && !processMessage(msgs[idx], th, labels, bugs)) {
      Utilities.sleep(1000);
      idx++;
    }
    Utilities.sleep(1000);
    count++;
  });
}
