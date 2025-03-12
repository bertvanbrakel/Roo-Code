# File System Utilities

The [`src/utils/fs.ts`](../src/utils/fs.ts) file defines utility functions for working with the file system. These functions provide a convenient way to perform common file system operations.

## Functions

The following functions are defined:

*   `createDirectoriesForFile(filePath)`: Creates all non-existing subdirectories for a given file path. This function ensures that the directory structure exists before writing a file to disk.
    *   **Parameters:**
        *   `filePath`: The path to the file.
    *   **Example:**
        ```typescript
        import { createDirectoriesForFile } from "../utils/fs";

        const filePath = "/path/to/my/file.txt";
        await createDirectoriesForFile(filePath);
        // The directories /path/to/my/ will be created if they don't exist.
        ```
*   `fileExistsAtPath(filePath)`: Checks if a path exists. This function can be used to determine whether a file or directory exists before attempting to access it.
    *   **Parameters:**
        *   `filePath`: The path to check.
    *   **Returns:** `true` if the path exists, `false` otherwise.
    *   **Example:**
        ```typescript
        import { fileExistsAtPath } from "../utils/fs";

        const filePath = "/path/to/my/file.txt";
        const exists = await fileExistsAtPath(filePath);
        if (exists) {
          console.log("File exists!");
        } else {
          console.log("File does not exist.");
        }
