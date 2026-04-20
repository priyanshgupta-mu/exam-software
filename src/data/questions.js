const QUESTIONS = [
  // ── Political Science & Government ──
  {
    text: 'Which of the following best describes the concept of "separation of powers" in democratic governments?',
    marks: 5,
    options: [
      'All government powers are held by a single elected leader',
      'Government authority is divided among legislative, executive, and judicial branches',
      'The military controls the legislative process',
      'Citizens directly vote on every law without representatives',
    ],
    answer: 1,
  },
  {
    text: 'Which principle ensures that no single branch of government becomes too powerful?',
    marks: 5,
    options: [
      'Federalism',
      'Checks and balances',
      'Popular sovereignty',
      'Judicial supremacy',
    ],
    answer: 1,
  },
  {
    text: 'What is the primary role of the judiciary in a democratic system?',
    marks: 5,
    options: [
      'To create new laws',
      'To enforce tax collection',
      'To interpret laws and ensure they are constitutional',
      'To appoint members of the legislature',
    ],
    answer: 2,
  },
  {
    text: 'Which form of government is characterized by a single ruler with absolute power?',
    marks: 5,
    options: [
      'Democracy',
      'Oligarchy',
      'Autocracy',
      'Theocracy',
    ],
    answer: 2,
  },
  {
    text: 'What does "universal suffrage" mean?',
    marks: 5,
    options: [
      'Only property owners can vote',
      'All adult citizens have the right to vote regardless of race, gender, or wealth',
      'Voting is mandatory for all citizens',
      'Only educated citizens can participate in elections',
    ],
    answer: 1,
  },

  // ── World History ──
  {
    text: 'What was a major consequence of the Treaty of Versailles after World War I?',
    marks: 5,
    options: [
      'Germany gained significant territory in Eastern Europe',
      'The United Nations was immediately established',
      'Germany was required to pay heavy reparations and accept war guilt',
      'France and Britain formed a single unified government',
    ],
    answer: 2,
  },
  {
    text: 'Which event is widely considered the immediate trigger for the start of World War I?',
    marks: 5,
    options: [
      'The signing of the Treaty of Versailles',
      'The invasion of Poland by Germany',
      'The assassination of Archduke Franz Ferdinand of Austria',
      'The sinking of the Lusitania',
    ],
    answer: 2,
  },
  {
    text: 'The Industrial Revolution began in which country during the late 18th century?',
    marks: 5,
    options: [
      'France',
      'Germany',
      'United States',
      'Great Britain',
    ],
    answer: 3,
  },
  {
    text: 'Which empire was known as the "sick man of Europe" before World War I?',
    marks: 5,
    options: [
      'Russian Empire',
      'Austro-Hungarian Empire',
      'Ottoman Empire',
      'British Empire',
    ],
    answer: 2,
  },
  {
    text: 'The Berlin Wall fell in which year, symbolizing the end of the Cold War era?',
    marks: 5,
    options: [
      '1985',
      '1987',
      '1989',
      '1991',
    ],
    answer: 2,
  },

  // ── Biology & Life Sciences ──
  {
    text: 'During photosynthesis, where do the light-dependent reactions primarily take place?',
    marks: 5,
    options: [
      'In the stroma of the chloroplast',
      'In the thylakoid membranes of the chloroplast',
      'In the mitochondrial matrix',
      'In the cell nucleus',
    ],
    answer: 1,
  },
  {
    text: 'What is the primary product of the Calvin cycle (light-independent reactions) in photosynthesis?',
    marks: 5,
    options: [
      'Oxygen gas',
      'ATP and NADPH',
      'Glucose (G3P)',
      'Water molecules',
    ],
    answer: 2,
  },
  {
    text: 'What is the powerhouse of the cell responsible for producing ATP?',
    marks: 5,
    options: [
      'Nucleus',
      'Ribosome',
      'Mitochondria',
      'Golgi apparatus',
    ],
    answer: 2,
  },
  {
    text: 'DNA replication occurs during which phase of the cell cycle?',
    marks: 5,
    options: [
      'G1 phase',
      'S phase',
      'G2 phase',
      'M phase',
    ],
    answer: 1,
  },
  {
    text: 'Which molecule carries amino acids to the ribosome during protein synthesis?',
    marks: 5,
    options: [
      'mRNA',
      'tRNA',
      'rRNA',
      'DNA polymerase',
    ],
    answer: 1,
  },

  // ── Economics & Globalization ──
  {
    text: 'Which of the following is a common challenge faced by developing nations due to globalization?',
    marks: 5,
    options: [
      'Complete isolation from international trade',
      'Increased income inequality and exploitation of cheap labor',
      'Decrease in foreign direct investment',
      'Elimination of all cultural exchange',
    ],
    answer: 1,
  },
  {
    text: 'Which of the following is a benefit of globalization for developing countries?',
    marks: 5,
    options: [
      'Reduced access to international markets',
      'Access to foreign technology, investment, and larger export markets',
      'Complete dependence on a single domestic industry',
      'Isolation from global supply chains',
    ],
    answer: 1,
  },
  {
    text: 'What does GDP (Gross Domestic Product) measure?',
    marks: 5,
    options: [
      'The total government debt of a country',
      'The total value of goods and services produced within a country in a given period',
      'The total imports minus exports of a country',
      'The average income of citizens in a country',
    ],
    answer: 1,
  },
  {
    text: 'Inflation is best described as:',
    marks: 5,
    options: [
      'A decrease in the unemployment rate',
      'A sustained increase in the general price level of goods and services',
      'An increase in the value of a country\'s currency',
      'A reduction in government spending',
    ],
    answer: 1,
  },
  {
    text: 'Which international organization primarily regulates global trade?',
    marks: 5,
    options: [
      'United Nations (UN)',
      'International Monetary Fund (IMF)',
      'World Trade Organization (WTO)',
      'World Health Organization (WHO)',
    ],
    answer: 2,
  },

  // ── Artificial Intelligence & Technology ──
  {
    text: 'What is a primary ethical concern associated with AI-driven medical diagnostics?',
    marks: 5,
    options: [
      'AI systems are too slow to process medical data',
      'AI cannot be used with any medical imaging technology',
      'Bias in training data may lead to inaccurate diagnoses for certain populations',
      'AI completely replaces the need for any human doctors',
    ],
    answer: 2,
  },
  {
    text: 'In the context of AI in healthcare, what does "explainability" refer to?',
    marks: 5,
    options: [
      'The ability of AI to replace human doctors entirely',
      'The ability to understand and interpret how an AI model reaches its decisions',
      'The speed at which AI processes medical records',
      'The cost of implementing AI systems in hospitals',
    ],
    answer: 1,
  },
  {
    text: 'Which type of machine learning uses labeled data to train a model?',
    marks: 5,
    options: [
      'Unsupervised learning',
      'Supervised learning',
      'Reinforcement learning',
      'Transfer learning',
    ],
    answer: 1,
  },
  {
    text: 'What is "deep learning" a subset of?',
    marks: 5,
    options: [
      'Quantum computing',
      'Machine learning',
      'Blockchain technology',
      'Cloud computing',
    ],
    answer: 1,
  },
  {
    text: 'Which technology is the backbone of cryptocurrencies like Bitcoin?',
    marks: 5,
    options: [
      'Artificial intelligence',
      'Cloud computing',
      'Blockchain',
      'Quantum computing',
    ],
    answer: 2,
  },

  // ── Environmental Science ──
  {
    text: 'What is the primary cause of the greenhouse effect?',
    marks: 5,
    options: [
      'Depletion of the ozone layer',
      'Trapping of heat by greenhouse gases like CO₂ and methane in the atmosphere',
      'Increased solar radiation due to sunspots',
      'Volcanic eruptions releasing ash into the atmosphere',
    ],
    answer: 1,
  },
  {
    text: 'Which renewable energy source generates electricity using the kinetic energy of moving air?',
    marks: 5,
    options: [
      'Solar energy',
      'Geothermal energy',
      'Wind energy',
      'Hydroelectric energy',
    ],
    answer: 2,
  },
  {
    text: 'The depletion of the ozone layer is primarily caused by:',
    marks: 5,
    options: [
      'Carbon dioxide emissions from vehicles',
      'Chlorofluorocarbons (CFCs) released from aerosols and refrigerants',
      'Methane released from agricultural activities',
      'Nitrogen oxide from industrial processes',
    ],
    answer: 1,
  },
  {
    text: 'What is biodiversity?',
    marks: 5,
    options: [
      'The total number of humans in an ecosystem',
      'The variety of life forms in a given habitat or ecosystem',
      'The amount of carbon stored in forests',
      'The rate at which species go extinct',
    ],
    answer: 1,
  },
  {
    text: 'Which international agreement aims to limit global warming to 1.5°C above pre-industrial levels?',
    marks: 5,
    options: [
      'Kyoto Protocol',
      'Montreal Protocol',
      'Paris Agreement',
      'Geneva Convention',
    ],
    answer: 2,
  },
]

export default QUESTIONS
