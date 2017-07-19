var workflow = require('v1/workflow');

var entities = require("v1/entities");
var webhookPostSync = require("./webhook_api").postSync;

var scriptId = Math.random();

exports.rule = entities.Issue.onChange({
  action: function(ctx) {
    if (ctx.issue.id === "Draft")
      return;

    var action;
    if (ctx.issue.becomesReported)
      action = "opened";
    else if (ctx.issue.comments.isChanged)
    // add/remove/edit
      action = "comments_changed";
    else
      action = "edited";

    var payload = {
      action: action,
      issueId: ctx.issue.id,
      projectId: ctx.issue.project.key,
    };
    
    webhookPostSync(payload);

    // on script update expect browser tab refresh to show a different number
    workflow.message(scriptId);
  }
});