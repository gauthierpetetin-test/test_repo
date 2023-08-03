import * as core from '@actions/core';
import { context, getOctokit } from '@actions/github';
import { GitHub } from '@actions/github/lib/utils';

main().catch((error: Error): void => {
  console.error(error);
  process.exit(1);
});

async function main(): Promise<void> {
  // "GITHUB_TOKEN" is an automatically generated, repository-specific access token provided by GitHub Actions.
  // We can't use "GITHUB_TOKEN" here, as its permissions are scoped to the repository where the action is running.
  // "GITHUB_TOKEN" does not have access to other repositories, even when they belong to the same organization.
  // As we want to update bug report issues which are not located in the same repository,
  // we need to create our own "BUG_REPORT_TOKEN" with "repo" permissions.
  // Such a token allows to access other repositories of the MetaMask organisation.
  const personalAccessToken = process.env.BUG_REPORT_TOKEN;
  if (!personalAccessToken) {
    core.setFailed('BUG_REPORT_TOKEN not found');
    process.exit(1);
  }

  const repoOwner = context.repo.owner; // MetaMask

  const bugReportRepo = process.env.BUG_REPORT_REPO;
  if (!bugReportRepo) {
      core.setFailed('BUG_REPORT_REPO not found');
      process.exit(1);
  }

  // Extract branch name from the context
  const branchName: string = context.payload.pull_request?.head.ref || "";
  
  // Extract semver version number from the branch name
  const releaseVersionNumberMatch = branchName.match(/^release\/(\d+\.\d+\.\d+)$/);
  
  if (!releaseVersionNumberMatch) {
    core.setFailed(`Failed to extract version number from branch name: ${branchName}`);
    process.exit(1);
  }

  const releaseVersionNumber = releaseVersionNumberMatch[1];

  if (!isValidVersionFormat(releaseVersionNumber)) {
    core.setFailed(`Extracted release version (${releaseVersionNumber}) is not a valid version format. The expected format is "x.y.z", where "x", "y" and "z" are numbers.`);
    process.exit(1);
  }

  // Initialise octokit, required to call Github GraphQL API
  const octokit: InstanceType<typeof GitHub> = getOctokit(personalAccessToken);

  const bugReportIssue = await retrieveOpenBugReportIssue(octokit, repoOwner, bugReportRepo, releaseVersionNumber);

  if(!bugReportIssue) {
    throw new Error(`No open bug report issue was found for release ${releaseVersionNumber} on ${repoOwner}/${bugReportRepo} repo`);
  }
  if(bugReportIssue.title?.toLocaleLowerCase() !== `v${releaseVersionNumber} Bug Report`.toLocaleLowerCase()) {
    throw new Error(`Unexpected bug report title: "${bugReportIssue.title}" instead of "v${releaseVersionNumber} Bug Report"`);
  }

  console.log(`Closing bug report issue with title "${bugReportIssue.title}" and id: ${bugReportIssue.id}`);

  await closeIssue(octokit, bugReportIssue.id);

  console.log(`Issue with id: ${bugReportIssue.id} successfully closed`);
  
}

// This helper function checks if version has the correct format: "x.y.z" where "x", "y" and "z" are numbers.
function isValidVersionFormat(str: string): boolean {
    const regex = /^\d+\.\d+\.\d+$/;
    return regex.test(str);
}

// This function retrieves the issue titled "vx.y.z Bug Report" on a specific repo
async function retrieveOpenBugReportIssue(octokit: InstanceType<typeof GitHub>, repoOwner: string, repoName: string, releaseVersionNumber: string): Promise<{
    id: string;
    title: string;
} | undefined> {

  const retrieveOpenBugReportIssueQuery = `
    query RetrieveOpenBugReportIssue($repoOwner: String!, $repoName: String!, $releaseVersionNumber: String!) {
      search(
          query: "repo:$repoOwner/$repoName type:issue is:open in:title v$releaseVersionNumber Bug Report"
          type: ISSUE
          first: 1
      ) {
          nodes {
              ... on Issue {
                  id
                  title
              }
          }
      }
    }
  `;

  const retrieveOpenBugReportIssueQueryResult: {
    search: {
        nodes: {
            id: string;
            title: string;
        }[];
    };
  } = await octokit.graphql(retrieveOpenBugReportIssueQuery, {
    repoOwner,
    repoName,
    releaseVersionNumber,
  });

  const bugReportIssues = retrieveOpenBugReportIssueQueryResult?.search?.nodes;

  return bugReportIssues?.length > 0 ? bugReportIssues[0] : undefined;
}

// This function closes a Github issue, based on its ID
async function closeIssue(octokit: InstanceType<typeof GitHub>, issueId: string): Promise<string> {

    const closeIssueMutation = `
      mutation CloseIssue($issueId: ID!) {
        updateIssue(input: {id: $issueId, state: CLOSED}) {
          clientMutationId
        }
      }
    `;
  
    const closeIssueMutationResult: {
      updateIssue: {
        clientMutationId: string;
      };
    } = await octokit.graphql(closeIssueMutation, {
      issueId,
    });
  
    const clientMutationId = closeIssueMutationResult?.updateIssue?.clientMutationId;
  
    return clientMutationId;
  }