export interface ChatSummary {
  title: string;
  topics: string[];
  tags: string[];
  contextProvided: {
    internalTools: string[];
    internalDefinitions: string[];
    externalResources: string[];
  };
  discussionProcess: string[];
  problemsDiscovered: string[];
  decidedSolutions: string[];
  domainKnowledge: {
    projectOverview?: string;
    targetUsers?: string;
    userFlows?: string[];
    techStack?: string[];
    keyTerms?: Record<string, string>;
  };
  actionItems?: string[];
}

export interface StoredSummary extends ChatSummary {
  id: string;
  sessionId: string;
  rawSummary: string;
  createdAt: string;
  modelUsed: string;
}

export interface Tag {
  id: number;
  name: string;
  color?: string;
  count?: number;
}
