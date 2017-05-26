export default {
  fieldsToIncludeAsLabels: [
    "Priority",
    "State",
    "Type",
  ],

  // note: field values are case sensitive
  closedStateFields: [
    "Can't Reproduce",
    "Duplicate",
    "Fixed",
    "Won't fix",
    "Incomplete",
    "Obsolete",
    "Verified",
  ],

  // note: tags are lowercase
  mirroringBlacklistTags: [
    "topsecret",
    "verysecurity",
    "muchpasswords",
    "suchcrypto",
  ],

  forceMirroringTag: "forcemirroring",

}
