# Date Range Component System

The date range component system provides a reusable, self-contained date range picker that can be instantiated multiple times throughout the dashboard.

## Features

- **Reusable**: Create multiple instances of date range pickers
- **Auto-synchronized**: All instances automatically sync with global date range changes
- **Self-contained**: Each component manages its own display and state
- **Dynamic**: Automatically detects and initializes new date range elements
- **Configurable**: Customizable options for each component instance
- **Memory Efficient**: Proper cleanup and memory management
- **Event-Driven**: Custom event handling for date range changes

## Architecture

### DateRangeComponent
Each date range component is a self-contained instance that:
- Manages its own DateRangePicker instance
- Handles display updates independently
- Provides custom event handling
- Supports configuration options

### DateRangeComponentManager
The global manager that:
- Tracks all component instances
- Provides automatic detection of new elements
- Handles global synchronization
- Manages memory cleanup

## Usage

### Basic Usage

Simply add a `.date-range` element to your HTML:

```html
<div class="date-range" onclick="toggleDateSelector()">
    <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
    </svg>
    <span class="date-range-text">All data</span>
</div>
```

The component system will automatically:
1. Detect the element
2. Create a date range component instance
3. Set up event listeners
4. Initialize with current global state
5. Handle synchronization with other components

### Programmatic Creation

You can also create components programmatically:

```javascript
// Create a component with default options
const element = document.querySelector('.my-date-range');
const component = createDateRangeComponent(element);

// Create a component with custom options
const component = createDateRangeComponent(element, {
    autoApply: true,
    showQuickRanges: true,
    showCustomDates: true,
    onDateChange: (range) => {
        console.log('Date range changed:', range);
    }
});
```

### Component Options

```javascript
const options = {
    autoApply: true,           // Automatically apply date changes
    showQuickRanges: true,     // Show quick range buttons
    showCustomDates: true,     // Show custom date inputs
    onDateChange: null         // Custom event handler
};
```

## API Reference

### Component Management Functions

#### `createDateRangeComponent(element, options)`
Creates a new date range component instance.

**Parameters:**
- `element` (HTMLElement): The DOM element to attach the component to
- `options` (Object): Configuration options (optional)

**Returns:** DateRangeComponent instance

#### `destroyDateRangeComponent(element)`
Destroys a date range component instance.

**Parameters:**
- `element` (HTMLElement): The DOM element with the component

#### `updateAllDateRangeDisplays()`
Updates all date range component displays with current global state.

#### `getDateRangeComponentManager()`
Gets the global component manager instance.

**Returns:** DateRangeComponentManager instance

### Component Instance Methods

#### `component.updateDisplay(rangeObj)`
Updates the component's display with the specified date range.

**Parameters:**
- `rangeObj` (Object): Date range object with start/end properties

#### `component.destroy()`
Destroys the component and cleans up resources.

## Advanced Usage

### Custom Event Handling

```javascript
const component = createDateRangeComponent(element, {
    onDateChange: (event) => {
        const { start, end, source } = event.detail;
        console.log('Date range changed:', { start, end, source });
        
        // Custom logic here
        updateCustomChart(start, end);
    }
});
```

### Dynamic Element Creation

```javascript
// Create a new date range element dynamically
const newDateRange = document.createElement('div');
newDateRange.className = 'date-range';
newDateRange.innerHTML = `
    <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
    </svg>
    <span class="date-range-text">Custom range</span>
`;

// Add to DOM
document.body.appendChild(newDateRange);

// Component will be automatically detected and initialized
```

### Multiple Instances

```html
<!-- Main dashboard date range -->
<div class="date-range" id="mainDateRange">
    <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
    </svg>
    <span class="date-range-text">All data</span>
</div>

<!-- Blog section date range -->
<div class="date-range" id="blogDateRange">
    <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
    </svg>
    <span class="date-range-text">All data</span>
</div>

<!-- Insights section date range -->
<div class="date-range" id="insightsDateRange">
    <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
    </svg>
    <span class="date-range-text">All data</span>
</div>
```

All three instances will be automatically synchronized and will update together when any one is changed.

## Implementation Details

### Automatic Detection

The component system uses a MutationObserver to automatically detect new `.date-range` elements:

1. **Scans for existing elements**: On initialization, scans for all `.date-range` elements
2. **Monitors DOM changes**: Watches for new elements being added
3. **Creates components**: Automatically creates component instances for new elements
4. **Maintains synchronization**: Ensures all components stay in sync

### Memory Management

Each component properly cleans up:
- Event listeners
- DOM references
- Picker instances
- Observer connections

### Global Synchronization

The system maintains global state through:
- Global date range management
- Event-driven updates
- Component manager coordination
- Automatic display updates

## Migration Guide

### From Legacy System

The new component system is backward compatible. Existing `.date-range` elements will automatically work with the new system.

**No changes required** for existing HTML:

```html
<!-- This will continue to work automatically -->
<div class="date-range" id="dateRange" onclick="toggleDateSelector()">
    <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
    </svg>
    <span id="dateRangeText">All data</span>
</div>
```

### Adding New Elements

Simply add new `.date-range` elements to your HTML:

```html
<!-- New element will be automatically detected and initialized -->
<div class="date-range" id="newDateRange">
    <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
    </svg>
    <span class="date-range-text">New range</span>
</div>
```

## Best Practices

### Element Structure

Ensure your date range elements follow this structure:

```html
<div class="date-range" [id="optional-id"] [onclick="toggleDateSelector()"]>
    <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
    </svg>
    <span class="date-range-text">Display text</span>
</div>
```

### Component Cleanup

When removing elements programmatically, destroy their components:

```javascript
const element = document.querySelector('.date-range');
if (element) {
    destroyDateRangeComponent(element);
    element.remove();
}
```

### Error Handling

The component system includes comprehensive error handling:

```javascript
try {
    const component = createDateRangeComponent(element);
} catch (error) {
    console.error('Failed to create date range component:', error);
}
```

## Troubleshooting

### Common Issues

1. **Element not detected**: Check that element has `.date-range` class
2. **Not synchronized**: Ensure component manager is initialized
3. **Memory leaks**: Always destroy components when removing elements
4. **Display not updating**: Check that global date range is being updated

### Debug Information

Enable debug logging:

```javascript
const manager = getDateRangeComponentManager();
console.log('Component count:', manager.components.size);
console.log('Active components:', Array.from(manager.components.keys()));
```

## Performance Considerations

- **Efficient Updates**: Only updates components that need updating
- **Memory Management**: Automatic cleanup prevents memory leaks
- **Event Optimization**: Uses event delegation for better performance
- **Lazy Initialization**: Components are created only when needed 