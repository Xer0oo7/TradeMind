// English translations for Peitho
const en = {
    // Common
    common: {
        home: 'Home',
        dashboard: 'Dashboard',
        product: 'Product',
        howItWorks: 'How It Works',
        pricing: 'Pricing',
        docs: 'Docs',
        back: 'Back',
        cancel: 'Cancel',
        submit: 'Submit',
        reset: 'Reset',
        close: 'Close',
        loading: 'Loading...',
        active: 'Active',
        accepted: 'Accepted',
        rejected: 'Rejected',
        expired: 'Expired',
        session: 'Session',
        sessions: 'Sessions',
        negotiations: 'Negotiations',
        analytics: 'Analytics',
        strategies: 'Strategies',
        apiUsage: 'API Usage',
        reporter: 'Dashboard',
        authority: 'Analytics',
        jury: 'Strategies',
        wallet: 'API',
        verified: 'Verified',
        pending: 'Pending',
        encrypted: 'Encrypted',
        reports: 'Sessions',
        stakeUsed: 'Profit',
        reputation: 'Success Rate',
        pendingRewards: 'Avg Margin',
    },

    // Language Selection Modal
    languageModal: {
        title: 'Choose Your Language',
        subtitle: 'Select your preferred language for the application',
        english: 'English',
        hindi: 'हिंदी (Hindi)',
        continue: 'Continue',
    },

    // Navbar
    navbar: {
        home: 'Home',
        reporter: 'Dashboard',
        authority: 'Analytics',
        jury: 'Strategies',
        wallet: 'API Docs',
    },

    // Landing Page
    landing: {
        badge: 'Profit-Aware AI',
        tradeMind: 'PEITHO',
        tagline: 'Smart Negotiations. Better Margins.',
        description: 'AI-powered pricing that maximizes profit while respecting your business rules. No random discounts. Just smart business logic.',
        notAChatbot: 'Intelligent. Profitable. Real.',
        buyAccess: 'Buy Access',
        viewApiDocs: 'View API Docs',
        startReporting: 'Buy Access',
        whatsApp: 'Try Our Chat',
        secureReport: 'PEITHO',

        // Stats
        stats: {
            anonymous: 'Rule-Based',
            encrypted: 'Decision Engine',
            available: 'Negotiation',
            zeroData: 'Guesswork',
        },

        // Role Cards (now Feature Cards)
        roleCards: {
            chooseYourPath: 'What Peitho Does',
            threeRolesOneMission: 'Intelligent Negotiation Infrastructure',
            enterDashboard: 'Learn More',
            reporter: {
                title: 'Max Profit Mode',
                description: 'Conservative concessions. Walks away if margins are threatened. Designed for healthy demand.',
            },
            authority: {
                title: 'Min Loss Mode',
                description: 'Controlled flexibility. Targets break-even first. Designed for clearance or slow-moving inventory.',
            },
            jury: {
                title: 'Deep Analytics',
                description: 'Every negotiation returns: final price, profit/loss, concessions used, efficiency score.',
            },
        },

        // Features Section
        features: {
            securityFirst: 'Built for Developers',
            builtForZeroTrust: 'API-First Architecture',
            privacyPriority: 'Every layer of Peitho is designed for seamless integration and full auditability.',
            clientSideEncryption: 'API-First SaaS',
            clientSideEncryptionDesc: 'RESTful API with session-based negotiation. Easy integration with any platform.',
            sessionBasedIdentity: 'Multi-Agent Architecture',
            sessionBasedIdentityDesc: 'Context, Pricing, and Conversation agents work together for optimal outcomes.',
            ipfsBlockchain: 'Fully Auditable',
            ipfsBlockchainDesc: 'Every decision is traceable. Know exactly why each price was offered.',
            authorityOnlyDecryption: 'Rate-Limited & Secure',
            authorityOnlyDecryptionDesc: 'Built-in rate limiting, session management, and constraint enforcement.',
        },

        // How it Works
        howItWorks: {
            simpleProcess: 'How It Works',
            title: 'Four Steps to Smarter Negotiation',
            step1Title: 'You Define the Rules',
            step1Desc: 'Set base price, cost price, minimum acceptable price, inventory pressure, and mode. These rules never change mid-negotiation.',
            step2Title: 'Buyers Negotiate',
            step2Desc: 'Buyers send offers through chat widgets, e-commerce platforms, or direct API calls. Peitho handles multi-round negotiations.',
            step3Title: 'AI Decides (Deterministically)',
            step3Desc: 'Context Agent sets strategy. Pricing Agent decides accept/counter/reject. Conversation Agent explains decisions. LLMs never decide prices.',
            step4Title: 'You See the Outcome',
            step4Desc: 'Every negotiation returns: final price vs starting price, profit or loss, concessions used, efficiency score.',
        },

        // CTA Section
        cta: {
            readyToReport: 'Ready to Negotiate Smarter?',
            safetyPriority: 'Stop guessing prices. Let Peitho handle negotiation — within your rules.',
            createAnonymousReport: 'Buy Peitho Access',
            authorityLogin: 'Read Documentation',
        },
    },

    // Reporter Home (now Dashboard)
    reporterHome: {
        title: 'Peitho Dashboard',
        subtitle: 'Active Negotiations & Insights',
        quickActions: 'Quick Actions',

        // Cards
        createReport: {
            title: 'New Negotiation',
            description: 'Start a new negotiation session with your product',
            action: 'Create Session',
        },
        silentReport: {
            title: 'Live Negotiation',
            description: 'Simulate buyer offers and see AI responses in real-time',
            action: 'Start Now',
        },
        myReputation: {
            title: 'Analytics',
            description: 'View pricing journey and profit metrics',
            action: 'View Analytics',
        },
        rewards: {
            title: 'API Usage',
            description: 'Monitor API health and usage statistics',
            action: 'View API',
        },

        // Recent Reports
        recentReports: 'Recent Negotiations',
        viewAllReports: 'View All Sessions →',
        category: 'Product',

        // Quick Tips
        earnMore: 'Pro Tips',
        tip1: 'Set realistic min_acceptable_price',
        tip2: 'Use MAX_PROFIT for high-demand items',
        tip3: 'Use MIN_LOSS for clearance inventory',

        // Privacy Banner
        privacyProtected: 'How Peitho Works',
        privacyMessage: 'Peitho never invents prices. It never violates constraints. It never chases bad deals. It never discounts blindly. Every decision is deterministic and auditable.',
    },

    // Report Page (now Create Negotiation)
    report: {
        title: 'Create Negotiation Session',
        backToDashboard: 'Back to Dashboard',
        endToEndEncrypted: 'API-Powered',

        // Categories (now Product fields)
        crimeCategory: 'Product Information',
        categories: {
            theft: 'Electronics',
            assault: 'Clothing',
            fraud: 'Fraud / Scam',
            corruption: 'Corruption / Bribery',
            harassment: 'Harassment',
            drugs: 'Drug-related',
            cybercrime: 'Cybercrime',
            other: 'Other',
        },

        // Severity
        severityLevel: 'Severity Level',
        low: 'Low',
        critical: 'Critical',

        // Description
        describeIncident: 'Describe the Incident',
        encryptionNote: 'This content will be encrypted before leaving your device',
        placeholder: 'Provide as much detail as possible about the incident. Include dates, locations, descriptions of people involved, and any other relevant information...',

        // Evidence
        evidence: 'Evidence',
        optional: '(optional)',
        chooseFiles: 'Choose Files',
        filesNote: 'Images, videos, documents • Max 10MB each',
        filesSelected: 'file(s) selected',

        // Errors
        selectCategoryAndEnter: 'Please select a category and enter your report',

        // Submit
        encryptAndSubmit: 'Encrypt & Submit Report',

        // Sidebar
        yourSafety: 'Your Safety',
        safety1: 'Report encrypted in browser',
        safety2: 'No personally identifiable data',
        safety3: 'Stored on decentralized IPFS',
        safety4: 'Only authorities can decrypt',

        earnRewards: 'Earn Rewards',
        earnRewardsDesc: 'Verified reports earn ETH rewards. Higher severity + detailed evidence = higher rewards.',
        averageReward: 'Average Reward',

        reportTips: 'Report Tips',
        tip1: 'Be specific with dates and times',
        tip2: 'Include location details',
        tip3: 'Describe suspects if known',
        tip4: 'Attach evidence if available',
        tip5: 'Review before submitting',

        disclaimer: 'By submitting, you confirm this is a genuine report. False reports will result in reputation penalties and stake slashing.',

        // Modal
        confirmSubmission: 'Confirm Submission',
        actionPermanent: 'This action is permanent',
        permanentWarning: 'Once submitted, your report cannot be modified or deleted. It will be permanently stored on the blockchain.',
        submitReport: 'Submit Report',

        // States
        encryptingReport: 'Encrypting Report...',
        encryptingInBrowser: 'Your report is being encrypted in this browser',
        naclInProgress: '🔐 NaCl encryption in progress...',

        submittingToBlockchain: 'Submitting to Blockchain...',
        storingOnIPFS: 'Storing on IPFS & recording proof on Ethereum',
        encryptedLocally: 'Encrypted locally',
        uploadingToIPFS: 'Uploading to IPFS...',
        recordingOnEthereum: 'Recording on Ethereum',

        reportSubmitted: 'Report Submitted!',
        reportStoredMessage: 'Your encrypted report has been stored on IPFS and verified on blockchain.',
        ipfsCid: 'IPFS CID',
        transactionHash: 'Transaction Hash',
        reportId: 'Report ID',
        viewOnEtherscan: 'View on Etherscan',
        backToDashboardBtn: 'Back to Dashboard',
    },

    // Silent Report
    silentReport: {
        title: 'Silent Report',
        subtitle: 'Tap to report without typing',
        backToDashboard: 'Back to Dashboard',
        howItWorks: 'How It Works',
        shortTap: 'Short tap (<0.5s)',
        longTap: 'Long tap (>0.5s)',
        quickCodes: 'Quick Codes:',
        patterns: {
            theft: 'Theft',
            assault: 'Assault',
            fraud: 'Fraud',
            harassment: 'Harassment',
            emergency: 'Emergency',
        },
        tapZone: 'Tap Zone',
        holding: 'HOLDING...',
        tapHere: 'TAP HERE',
        yourPattern: 'Your Pattern',
        waitingForTaps: 'Waiting for taps...',
        decodedResult: 'Decoded Result',
        category: 'Category',
        severity: 'Severity',
        notDetected: 'Not detected',
        submitSilentReport: 'Submit Silent Report',
        silentReportSent: 'Silent Report Sent!',
        transmitted: 'Your {category} has been transmitted silently.',
        pattern: 'Pattern:',
    },

    // Authority Dashboard
    authority: {
        badge: 'Business Analytics',
        title: 'Analytics Dashboard',
        subtitle: 'Calculate business metrics, visualize performance, and get insights',
        refresh: 'Reset',
        totalReports: 'Gross Revenue',
        pendingReview: 'Net Profit',
        verified: 'Profit Margin',
        rejected: 'Conversion Rate',
        reports: 'Products',
        reportDetails: 'Analytics Details',
        selectReportToDecrypt: 'Enter product data and calculate analytics',
        decrypting: 'Calculating analytics...',
        decryptionFailed: 'Calculation failed:',
        decryptedReport: 'Analytics Results',
        aiAnalysis: 'Business Insights',
        spam: 'Loss',
        urgency: 'Urgency',
        category: 'Category',
        credibility: 'ROI',
        suggestedAction: 'Recommended Action',
        verifyAndReward: 'Calculate',
        reject: 'Reset',
        reportVerifiedRewarded: 'Your product is profitable.',
        reportRejected: 'Your product is at a loss.',
        loadingReports: 'Loading analytics...',
        noReportsFound: 'No analytics data yet',
        status: {
            underReview: 'Pending',
            verified: 'Profitable',
            rejected: 'Loss',
            pending: 'Pending',
        },
        filterAll: 'All',
        filterReview: 'Warning',
    },

    // Jury Dashboard
    jury: {
        badge: 'Dispute Resolution',
        title: 'Jury Dashboard',
        subtitle: 'Vote on disputed reports. Your influence is weighted by reputation.',
        yourRep: 'Your Rep',
        voteWeight: 'Vote Weight',
        casesJudged: 'Cases Judged',
        successRate: 'Success Rate',
        allDisputes: 'All Disputes',
        active: 'Active',
        ended: 'Ended',
        categorySeverity: 'Category / Severity',
        reportSummary: 'Report Summary',
        reporterRep: 'Reporter Rep:',
        authorityRejection: "Authority's Rejection",
        reporterAppeal: "Reporter's Appeal",
        valid: 'Valid',
        invalid: 'Invalid',
        voters: 'voters',
        verdict: 'Verdict:',
        reportValid: 'Report Valid',
        reportInvalid: 'Report Invalid',
        youVoted: 'You voted:',
        voteValid: 'Vote Valid',
        voteInvalid: 'Vote Invalid',
        reputationWeightedVoting: 'Reputation-Weighted Voting',
        votingExplanation: 'Your vote is weighted by your reputation score. Higher reputation = more influence on the outcome. Voting correctly on disputes increases your reputation and earns rewards.',
    },

    // Wallet Dashboard
    wallet: {
        badge: 'Anonymous Wallet',
        title: 'Wallet Dashboard',
        subtitle: 'Stake reports and claim your rewards',
        address: 'Address',
        ethBalance: 'ETH Balance',
        usdcBalance: 'USDC Balance',
        pendingRewards: 'Pending Rewards',
        staked: 'Staked',
        stakeEth: 'Stake ETH',
        claimRewards: 'Claim Rewards',
        exportKey: 'Export Key',
        transactionHistory: 'Transaction History',
        reportVerified: 'Report Verified',
        reportStake: 'Report Stake',
        juryReward: 'Jury Reward',
        viewAllTransactions: 'View All Transactions →',
        totalValue: 'Total Value',
        change24h: '24h Change',
        staking: 'Staking',
        currentlyStaked: 'Currently Staked',
        pendingReportsCount: 'Pending Reports',
        estReturns: 'Est. Returns',
        security: 'Security',
        securityNote: 'This is a custodial wallet managed by SAYLESS. You can export your private key at any time. All transactions are on Ethereum Sepolia testnet.',
    },

    // Reputation Page
    reputation: {
        title: 'Reputation Profile',
        subtitle: 'Your pseudonymous identity on SAYLESS. Build reputation through verified reports.',
        anonymousIdentity: 'Anonymous Identity',
        reputationScore: 'Reputation Score',
        howItWorks: 'How Reputation Works',
        verifiedReports: 'Verified reports:',
        rejectedReports: 'Rejected reports:',
        correctJuryVotes: 'Correct jury votes:',
        wrongJuryVotes: 'Wrong jury votes:',
        higherRepHigherWeight: 'Higher reputation = Higher vote weight in jury',
        reportStatistics: 'Report Statistics',
        totalReports: 'Total Reports',
        accepted: 'Accepted',
        rejected: 'Rejected',
        acceptanceRate: 'Success Rate',
        juryParticipation: 'Strategy Usage',
        totalVotes: 'Total Sessions',
        correct: 'Profitable',
        incorrect: 'Loss',
        voteAccuracy: 'Win Rate',
        rewardsEarned: 'Total Profit',
        penalties: 'Total Loss',
        recentActivity: 'Recent Activity',
        tiers: {
            newcomer: 'Starter',
            regular: 'Regular',
            trusted: 'Pro',
            expert: 'Expert',
            guardian: 'Enterprise',
        },
    },

    // Footer
    footer: {
        description: 'AI Negotiation Engine for Smarter Pricing. Peitho negotiates on behalf of sellers while protecting margins.',
        quickLinks: 'Quick Links',
        startReporting: '→ Start Negotiating',
        authorityDashboard: '→ View Dashboard',
        checkReputation: '→ API Documentation',
        disclaimer: 'Disclaimer',
        disclaimerText: 'Peitho is an AI-powered negotiation engine. All pricing decisions are deterministic and based on seller-defined constraints.',
        copyright: '© 2026 Peitho • Intelligent Negotiation Infrastructure',
    },

    // Alert Banner
    alertBanner: {
        message: ' AI-POWERED • PROFIT-AWARE • CONSTRAINT-PROTECTED • FULLY AUDITABLE • ',
    },

    // Market Dock
    market: {
        market: 'MARKET',
        marketCheck: 'Market check',
        upToLower: 'up to {percent}% lower',
        lowerThanSource: '{percent}% lower than {source}',
        belowSource: '{amount} below {source}',
        sampleData: 'SAMPLE DATA',
        liveCheckedAgo: 'LIVE · checked {time} ago',
        demoNote: 'Demo estimates. Tap a row to search the retailer.',
        liveNote: 'Prices from public listings',
        searchOn: 'Search on {retailer}',
        viewListing: 'View listing',
        minutesAgo: '{count} min',
        hoursAgo: '{count} hr',
        refresh: 'Refresh',
        close: 'Close',
        cheaperThanMarket: '{count} cheaper than market',
    }
};

export default en;
