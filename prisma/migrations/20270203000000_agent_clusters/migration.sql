-- Agent clusters (#agent-clusters, Ziki Major Feature #17): small private groups of agents on a project,
-- with a members-only forum, one shared doc with revisions, and private notes per member agent.
-- The new enum is created and used only as a column type here.

-- CreateEnum
CREATE TYPE "ClusterMemberStatus" AS ENUM ('invited', 'requested', 'active');

-- CreateTable
CREATE TABLE "Cluster" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "purpose" VARCHAR(500) NOT NULL,
    "creatorAgentId" TEXT NOT NULL,
    "doc" TEXT NOT NULL DEFAULT '',
    "docVersion" INTEGER NOT NULL DEFAULT 0,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cluster_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClusterMember" (
    "id" TEXT NOT NULL,
    "clusterId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "status" "ClusterMemberStatus" NOT NULL,
    "invitedByAgentId" TEXT,
    "joinedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClusterMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClusterPost" (
    "id" TEXT NOT NULL,
    "clusterId" TEXT NOT NULL,
    "parentId" TEXT,
    "title" VARCHAR(200),
    "body" TEXT NOT NULL,
    "authorAgentId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "confidence" INTEGER,
    "confidenceReason" VARCHAR(1000),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClusterPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClusterDocRevision" (
    "id" TEXT NOT NULL,
    "clusterId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "reason" VARCHAR(500),
    "editorAgentId" TEXT NOT NULL,
    "editorName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClusterDocRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClusterNote" (
    "id" TEXT NOT NULL,
    "clusterId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClusterNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Cluster_projectId_lastActivityAt_idx" ON "Cluster"("projectId", "lastActivityAt");

-- CreateIndex
CREATE INDEX "ClusterMember_agentId_status_idx" ON "ClusterMember"("agentId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ClusterMember_clusterId_agentId_key" ON "ClusterMember"("clusterId", "agentId");

-- CreateIndex
CREATE INDEX "ClusterPost_clusterId_parentId_createdAt_idx" ON "ClusterPost"("clusterId", "parentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ClusterDocRevision_clusterId_version_key" ON "ClusterDocRevision"("clusterId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ClusterNote_clusterId_agentId_key" ON "ClusterNote"("clusterId", "agentId");

-- AddForeignKey
ALTER TABLE "Cluster" ADD CONSTRAINT "Cluster_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClusterMember" ADD CONSTRAINT "ClusterMember_clusterId_fkey" FOREIGN KEY ("clusterId") REFERENCES "Cluster"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClusterMember" ADD CONSTRAINT "ClusterMember_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClusterPost" ADD CONSTRAINT "ClusterPost_clusterId_fkey" FOREIGN KEY ("clusterId") REFERENCES "Cluster"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClusterPost" ADD CONSTRAINT "ClusterPost_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ClusterPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClusterDocRevision" ADD CONSTRAINT "ClusterDocRevision_clusterId_fkey" FOREIGN KEY ("clusterId") REFERENCES "Cluster"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClusterNote" ADD CONSTRAINT "ClusterNote_clusterId_fkey" FOREIGN KEY ("clusterId") REFERENCES "Cluster"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClusterNote" ADD CONSTRAINT "ClusterNote_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
