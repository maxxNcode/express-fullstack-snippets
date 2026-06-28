const assert = require('assert');
const ScreenGenerator = require('../src/screenGenerator');

describe('ScreenGenerator', function() {
    describe('generateTransactionPage', function() {
        it('should produce HTML with PAGE_CONFIG embedded', function() {
            const mockRegistry = {
                getScreen: () => null,
                getTables: () => ['Candidates', 'Positions'],
                getTable: (name) => name === 'Candidates' ? {
                    fields: [
                        { name: 'candID', type: 'INTEGER', pk: true },
                        { name: 'candFName', type: 'TEXT' },
                        { name: 'candLName', type: 'TEXT' }
                    ]
                } : {
                    fields: [
                        { name: 'posID', type: 'INTEGER', pk: true },
                        { name: 'posName', type: 'TEXT' }
                    ]
                },
                getQuery: () => null,
                getActionRoutes: () => []
            };
            const gen = new ScreenGenerator(mockRegistry);
            const screen = {
                name: 'castVote',
                title: 'Cast Your Vote',
                type: 'transaction',
                auth: true,
                display: {
                    layout: 'grouped',
                    groupField: 'posID',
                    groupHeader: 'posName',
                    fields: [
                        { table: 'Candidates', field: 'candID', displayAs: 'selectable' },
                        { table: 'Candidates', field: 'candFName', show: true },
                        { table: 'Candidates', field: 'candLName', show: true }
                    ]
                },
                input: {
                    selectionType: 'radio',
                    limitField: 'Positions.numOfPositions',
                    hiddenFields: [
                        { name: 'posID', source: 'fixed:1' },
                        { name: 'voterID', source: 'jwt.id' }
                    ],
                    actionRoute: 'castVote',
                    batch: true
                },
                result: {
                    type: 'message',
                    successMessage: 'Vote recorded!',
                    failureMessage: 'Vote failed.'
                }
            };
            const html = gen.generateTransactionPage(screen);
            assert(html.includes('PAGE_CONFIG'), 'Must embed PAGE_CONFIG');
            assert(html.includes('loadScreen()'), 'Must call loadScreen');
            assert(html.includes('submitScreen()'), 'Must call submitScreen');
            assert(html.includes('Cast Your Vote'), 'Must include title');
            assert(html.includes('screenContainer'), 'Must have container');
            assert(html.includes('submitBtn'), 'Must have submit button');
            assert(html.includes('resultArea'), 'Must have result area');
            assert(html.includes('auth.js'), 'Must include auth.js for authenticated screens');
            assert(html.includes('redirectIfNotAuthenticated()'), 'Must redirect if not authenticated');
        });
    });

    describe('generateReportPage', function() {
        it('should produce HTML with computed column support', function() {
            const mockRegistry = {
                getScreen: () => null,
                getTables: () => [],
                getTable: () => null,
                getQuery: (name) => name === 'electionResultsQuery' ? { columns: [] } : null,
                getActionRoutes: () => []
            };
            const gen = new ScreenGenerator(mockRegistry);
            const screen = {
                name: 'electionResults',
                title: 'Election Results',
                type: 'report',
                query: 'electionResultsQuery',
                display: {
                    layout: 'grouped-table',
                    groupField: 'posName',
                    columns: [
                        { field: 'candName', label: 'Candidate' },
                        { field: 'totalVotes', label: 'Votes', format: 'number' },
                        { field: '__pct__', label: '%', format: 'percentage-bar' },
                        { field: '__rank__', label: 'Rank' }
                    ]
                },
                computedColumns: {
                    '__pct__': { type: 'percentage', of: 'group', sourceField: 'totalVotes' },
                    '__rank__': { type: 'rank', sortField: 'totalVotes', direction: 'desc', perGroup: true }
                }
            };
            const html = gen.generateReportPage(screen);
            assert(html.includes('PAGE_CONFIG'), 'Must embed PAGE_CONFIG');
            assert(html.includes('loadReport()'), 'Must call loadReport');
            assert(html.includes('computedColumns'), 'Must include computedColumns');
            assert(html.includes('Election Results'), 'Must include title');
        });
    });

    describe('generateWidgetHtml', function() {
        it('should produce a widget snippet', function() {
            const mockRegistry = {
                getScreen: () => null,
                getTables: () => [],
                getTable: () => null,
                getQuery: () => null,
                getActionRoutes: () => []
            };
            const gen = new ScreenGenerator(mockRegistry);
            const screen = {
                name: 'voterCount',
                title: 'Total Voters',
                type: 'widget',
                query: 'SELECT COUNT(*) as count FROM Voters',
                icon: '\uD83D\uDC65',
                label: 'Active Voters',
                link: '/voters.html',
                color: '#0078d4'
            };
            const html = gen.generateWidgetHtml(screen);
            assert(html.includes('voterCount'), 'Must include name class/id');
            assert(html.includes('Active Voters'), 'Must include label');
            assert(html.includes('/voters.html'), 'Must include link');
            assert(html.includes('widget-card'), 'Must have widget-card class');
        });
    });

    describe('generateTransactionDataRoute', function() {
        it('should produce Express route code', function() {
            const mockRegistry = {
                getTable: (name) => name === 'Candidates' ? {
                    fields: [
                        { name: 'candID', type: 'INTEGER', pk: true },
                        { name: 'candFName', type: 'TEXT' },
                        { name: 'candLName', type: 'TEXT' }
                    ]
                } : { fields: [] },
                getActionRoutes: () => []
            };
            const gen = new ScreenGenerator(mockRegistry);
            const screen = {
                name: 'castVote',
                display: {
                    fields: [
                        { table: 'Candidates', field: 'candID', displayAs: 'selectable' },
                        { table: 'Candidates', field: 'candFName', show: true }
                    ]
                },
                input: {}
            };
            const route = gen.generateTransactionDataRoute(screen);
            assert(route.includes('/api/castVote/data'), 'Must include data endpoint');
            assert(route.includes('SELECT'), 'Must include SELECT');
            assert(route.includes('authenticate'), 'Must use authenticate middleware');
        });
    });

    describe('_escapeHtml', function() {
        it('should escape HTML special characters', function() {
            const gen = new ScreenGenerator({});
            assert.strictEqual(gen._escapeHtml('<script>&"\'</script>'), '&lt;script&gt;&amp;&quot;&#039;&lt;/script&gt;');
        });
    });
});
