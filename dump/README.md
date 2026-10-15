# Veave Database Dump

This directory contains the database dump of the MongoDB `veave` database.

## Contents
- **`veave_mongo_dump.zip`**: Compressed archive containing individual JSON exports of all collections.
- **`summary.json`**: Document count and metadata overview of the dump.

## Collections & Document Counts
- `project_files`: 1,662 documents
- `conversations`: 97 documents
- `projectversions`: 66 documents
- `aiusages`: 46 documents
- `generationjobs`: 43 documents
- `projectfiles`: 37 documents
- `projects`: 14 documents
- `previewartifacts`: 3 documents
- `themepalettes`: 2 documents
- `payments`: 2 documents
- `users`: 2 documents
- `customfonts`: 1 document
- `promptruns`: 0 documents
- **Total**: 1,975 documents across 13 collections

## Restoring the Database
To restore this dump into your local MongoDB:
```bash
cd backend
npm run restore:db
```
Or manually extract `veave_mongo_dump.zip` into `dump/latest/` and use `mongoimport`.
