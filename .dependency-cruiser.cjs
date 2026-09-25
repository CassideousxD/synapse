module.exports = {
  forbidden: [
    {
      name: "teacher-side-cannot-touch-student-data",
      comment: "Privacy boundary: teacher-web may depend only on contracts.",
      severity: "error",
      from: { path: "^apps/teacher-web" },
      to: { path: "^packages/(note-store|student-ai|embeddings|agent-runtime|sync)" },
    },
    {
      name: "note-store-is-a-leaf",
      comment: "Storage stays pure: no network, no AI, no sync imports.",
      severity: "error",
      from: { path: "^packages/note-store" },
      to: { path: "^packages/(llm-client|sync|student-ai)" },
    },
  ],
};
