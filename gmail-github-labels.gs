// This requires a sheet called gmail-github-labels with configiuration data in the first column
// The following data should be provided:
// access_token - (required) a github access token from https://github.com/settings/tokens/new
// me - your github username (if set a label called 'mine' will be added to your bugs).
// labels - the labels you are interested in having copied over to gmail.
// timezone_offset - hours difference from UTC (to work out the date of yesterday).
// repositories - the list of repos you want to check issues for (e.g. arkarkark/gmail-github-labels)
//
// Lists are provided in one value per cell horizontally.

var access_token = '';
var me = '';
var github_labels = [];
var timezone_offset = -8;
var repositories = [];

var bugs = {};
var props = PropertiesService.getUserProperties();

function setupGmailGithubLabels() {
  getConfig();
  GmailApp.createLabel('github');
  getLabelNames().forEach(function(label) {
    Logger.log('Making label: %s', 'github/' + label);
    GmailApp.createLabel('github/' + label);
  });
}

function runGmailGithubLabels() {
  processEmails();
}

function debugShowProperties() {
  var p = props.getProperties();
  var keys = Object.keys(p);
  for (var i = 0; i < keys.length; i++) {
    Logger.log('%s:%s: %s', i, keys[i], p[keys[i]]);
  }
}

var yesterday = function() {
  var d = new Date();
  d.setHours(d.getHours() + timezone_offset);
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
};

var getLabelNames = function() {
  return [].concat(github_labels, 'open,closed,mine'.split(','));
};

var queryString = function(params) {
  var qs = [];
  var keys = Object.keys(params);
  for (var i = 0; i < keys.length; i++) {
    qs.push(encodeURIComponent(keys[i]) + '=' + encodeURIComponent(params[keys[i]]));
  }
  return qs.join('&');
};


var getConfig = function() {
  var githubSheet;
  SpreadsheetApp.getActiveSpreadsheet().getSheets().forEach(function(sheet) {
    if (sheet.getName() == 'gmail-github-labels') {
      githubSheet = sheet;
    }
  });
  if (githubSheet) {
    Logger.log('Found sheet with config!');
  }
  var values = githubSheet.getRange(1, 1, githubSheet.getMaxRows() - 1, githubSheet.getMaxColumns() - 1).getValues();
  for (var row in values) {
    if (values[row][0]) {
      switch (values[row][0]) {
        case 'access_token': access_token = values[row][1]; break;
        case 'me': me = values[row][1]; break;
        case 'timezone_offset': timezone_offset = values[row][1]; break;
        case 'labels': github_labels = values[row].slice(1).filter(function(x) { return x;}); break;
        case 'repositories': repositories = values[row].slice(1).filter(function(x) { return x;}); break;
      }
    }
  }
  Logger.log('Config Read:');
  Logger.log('access_token: %s', access_token);
  Logger.log('me: %s', me);
  Logger.log('timezone_offset: %s', timezone_offset);
  Logger.log('github_labels: %s', JSON.stringify(github_labels));
  Logger.log('repositories: %s', JSON.stringify(repositories));
};

var github = function(path, params) {
  params.access_token = access_token;
  var url = 'https://api.github.com' + path + '?' + queryString(params);
  Logger.log('opening: ' + url);
  return JSON.parse(UrlFetchApp.fetch(url).getContentText());
};

var getGmailLabels = function() {
  labels = {};
  getLabelNames().forEach(function(label) {
    labels['github/' + label] = GmailApp.getUserLabelByName('github/' + label);
  });
  return labels;
};

var getBodyLastCalled = 0;

var getBugUrlFromMessage = function(msg) {
  var now = new Date().getTime(); // milliseconds
  var diff = now - getBodyLastCalled;
  if (diff < 1000) {
    Logger.log('throttling call to getPlainBody: ' + diff + ' milliseconds');
    Utilities.sleep(diff);
  }
  getBodyLastCalled = now;

  var content = msg.getPlainBody().split('\n');
  if (!content.length) {
    return false;
  }
  var lastLine = content[content.length - 1];
  var match = lastLine.match(new RegExp('^(https://github.com/[^/]*/[^/]*/(issues|pull)/[0-9]+)'));
  if (!match) {
    return false;
  }
  return match[1];
};

var getBugForThread = function(th) {
  var propKey = 'bugUrlForThreadId:' + th.getId();
  Logger.log('finding bug for thread: ' + propKey);
  var bugUrl = props.getProperty(propKey);
  if (bugUrl) {
    Logger.log('found bugUrl via props!');
    return bugs[bugUrl];
  }
  var msgs = th.getMessages();
  Logger.log(msgs.length + ' messages in: ' + th.getFirstMessageSubject());
  if (!msgs.length) {
    return;
  }
  var idx = 0;
  while (idx < msgs.length) {
    bugUrl = getBugUrlFromMessage(msgs[idx]);
    if (bugUrl) {
      Logger.log('found it at index: ' + idx + ' // ' + bugUrl);
      props.setProperty(propKey, bugUrl);
      return bugs[bugUrl];
    }
    idx++;
  }
  Logger.log('unable to find bug for thread: ' + th.getId() + ' // ' + th.getFirstMessageSubject());
};

var processThread = function(th) {
  var bug = getBugForThread(th);
  if (!bug) {
    return;
  }
  var threadLabels = th.getLabels();
  Logger.log('bug: ' + bug.number + ' has this many gmail labels: ' + threadLabels.length );
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
  label('mine', bug.assignee && me && bug.assignee.login == me);
  bug.labels.forEach(function(l) {
    label(l.name, !open ? false : github_labels.indexOf(l.name) != -1);
  });
};

var processEmails = function() {
  getConfig();
  labels = getGmailLabels();
  var urls = ['/issues'];
  repositories.forEach(function(repo) {
    urls.push('/repos/' + repo + '/issues');
  });
  urls.forEach(function(url) {
    github(url, {'since': yesterday(), 'state': 'all'}).forEach(function(bug) {
      bugs[bug.html_url] = bug;
    });
  });
  GmailApp.search('"view it on github" after:' + yesterday()).forEach(processThread);
};
