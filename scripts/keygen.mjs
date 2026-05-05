#!/usr/bin/env node
import { randomBytes } from "node:crypto";

const key = randomBytes(32).toString("hex");
console.log(`\nVMUI_MASTER_KEY=${key}\n`);
console.log("Copy that line into your .env file.\n");
