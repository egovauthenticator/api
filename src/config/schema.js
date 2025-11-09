// src/config/schema.js
// Keep to Gemini-supported subset of JSON schema.
export const extractionSchema = {
  type: "object",
  properties: {
    type:          { type: "string" },
    id:            { type: "string" },
    name:          { type: "string" },
    firstName:     { type: "string" },
    middleName:    { type: "string" },
    lastName:      { type: "string" },
    sex:           { type: "string" },
    dateOfBirth:   { type: "string" },
    placeOfBirth:  { type: "string" },
    address:       { type: "string" },
    precintNo:     { type: "string" },
    votersIdNumber:{ type: "string" },
    others:        { type: "string" }
  },
  required: [
    "type",
    "id",
    "name",
    "firstName",
    "middleName",
    "lastName",
    "sex",
    "dateOfBirth",
    "placeOfBirth",
    "address",
    "precintNo",
    "votersIdNumber",
    "others"
  ]
};
