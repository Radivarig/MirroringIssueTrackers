export default {
  fieldsToIncludeAsLabels: [
    "Priority",
    "State",
    "Type",
  ],

  // note: field values are case sensitive
  closedFieldStateValues: [
    "Done",
    "Aborted",
    "Duplicate",
    /*
    "Can't Reproduce",
    "Duplicate",
    "Fixed",
    "Won't fix",
    "Incomplete",
    "Obsolete",
    "Verified",
    */
  ],

  // note: tags are lowercase
  mirroringBlacklistTags: [
    "topsecret",
  ],

  // note: case isensitive
  sensitiveStrings: [
    "password",
    "auth",
    "security",
  ],

}
