# Git Utilities

The [`src/utils/git.ts`](../src/utils/git.ts) file defines utility functions for working with Git repositories. These functions provide a convenient way to interact with Git from within the extension.

## Functions

The following functions are defined:

*   `searchCommits(query, cwd)`: Searches for commits matching a query in the specified working directory. This function allows you to find commits that contain specific keywords or patterns.
    *   **Parameters:**
        *   `query`: The search query.
        *   `cwd`: The working directory to search in.
    *   **Returns:** A promise that resolves to an array of commit objects.
    *   **Example:**
        ```typescript
        import { searchCommits } from "../utils/git";

        const commits = await searchCommits("fix: bug", "/path/to/repo");
        console.log(commits);
        ```
*   `getCommitInfo(hash, cwd)`: Retrieves information about a specific commit in the specified working directory. This function allows you to get details about a commit, such as the author, date, and message.
    *   **Parameters:**
        *   `hash`: The commit hash.
        *   `cwd`: The working directory to search in.
    *   **Returns:** A promise that resolves to a commit object.
    *   **Example:**
        ```typescript
        import { getCommitInfo } from "../utils/git";

        const commit = await getCommitInfo("a1b2c3d4e5f6", "/path/to/repo");
        console.log(commit);
        ```
*   `getWorkingState(cwd)`: Retrieves the status of the working directory. This function allows you to check if there are any uncommitted changes in the working directory.
    *   **Parameters:**
        *   `cwd`: The working directory to check.
    *   **Returns:** A promise that resolves to an object containing the working directory status.
    *   **Example:**
        ```typescript
        import { getWorkingState } from "../utils/git";

        const workingState = await getWorkingState("/path/to/repo");
        console.log(workingState);
