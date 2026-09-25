// Fixed command development corpus and independent wording variations.
export const COMMAND_CASES = [
  {text:'Collect 200 ore',goal:'ore'},
  {text:'Keep everyone fed and collect 200 ore',goal:'ore'},
  {text:'Grow to 50 Tripelkins',goal:'grow'},
  {text:'Finish the bridge',goal:'bridge'},
  {text:'Keep everyone healthy',goal:'care'},
  {text:'Hello',goal:'none'},
  {text:'How much ore do we have?',goal:'none'},
  {text:'Please stockpile 80 blocks',goal:'blocks'},
  {text:'Please gather 120 wood',goal:'wood',holdout:true},
  {text:'Mine 50 ore while keeping everyone healthy',goal:'ore',holdout:true},
  {text:'Please help us reach 80 Tripelkins',goal:'grow',holdout:true},
  {text:'What is our next project?',goal:'none',holdout:true},
];
