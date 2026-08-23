import fs from "node:fs";
import path from "node:path";
import { draftReferenceNameSchema } from "@pushdraft/contracts";

import { isJsonObject } from "./api-types.js";
import { CliError, errorMessage } from "./errors.js";

export interface LocalImageReference {
  name: string;
  filename: string;
}

export function readReferencesManifest(filename: string): LocalImageReference[] {
  const resolvedFilename = path.resolve(filename);
  let source: string;
  try {
    source = fs.readFileSync(resolvedFilename, "utf8");
  } catch (error) {
    if (!fs.existsSync(resolvedFilename)) {
      throw new CliError(`References manifest does not exist: ${resolvedFilename}`);
    }
    throw new CliError(`Could not read references manifest: ${resolvedFilename}`, { cause: error });
  }

  let value: unknown;
  try {
    value = JSON.parse(source) as unknown;
  } catch (error) {
    throw new CliError(
      `References manifest is not valid JSON: ${resolvedFilename}\n${errorMessage(error)}`,
      { cause: error },
    );
  }

  if (!isJsonObject(value)) {
    throw new CliError(
      `References manifest must be a JSON object that maps names to image paths: ${resolvedFilename}`,
    );
  }

  const entries = Object.entries(value);
  if (entries.length === 0) {
    throw new CliError(`References manifest cannot be empty: ${resolvedFilename}`);
  }

  const baseDirectory = path.dirname(resolvedFilename);
  return entries
    .map(([name, imagePath]) => {
      if (!draftReferenceNameSchema.safeParse(name).success) {
        throw new CliError(
          `Invalid reference name "${name}" in ${resolvedFilename}. Names must start with a lowercase letter and contain only lowercase letters, digits, or hyphens.`,
        );
      }
      if (typeof imagePath !== "string" || imagePath.trim() === "") {
        throw new CliError(
          `Reference "${name}" in ${resolvedFilename} must contain a non-empty image path.`,
        );
      }

      return {
        name,
        filename: path.resolve(baseDirectory, imagePath),
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}
